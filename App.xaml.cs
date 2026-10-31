using System.Windows;
using Aurora.Web;

namespace Aurora;

public partial class App : Application
{
    private ApiServer? _server;

    public static AppState State { get; private set; } = null!;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        ShutdownMode = ShutdownMode.OnMainWindowClose;

        try
        {
            State = await AppState.CreateAsync();
            _server = await ApiServer.StartAsync(State);

            var win = new MainWindow(_server.BaseUrl + "/?t=" + _server.Token);
            MainWindow = win;
            win.Show();

            // 调试便利：把当前会话的地址与 token 落盘（仅本机）
            try
            {
                System.IO.File.WriteAllText(
                    System.IO.Path.Combine(AppPaths.DataDir, "endpoint.txt"),
                    _server.BaseUrl + "/?t=" + _server.Token);
            }
            catch
            {
                // 忽略：仅调试用途
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.ToString(), "Aurora 启动失败", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            _server?.DisposeAsync().AsTask().Wait(3000);
        }
        catch
        {
            // 退出路径不需要再抛异常
        }

        base.OnExit(e);
    }
}
