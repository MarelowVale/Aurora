using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace Aurora;

public partial class MainWindow : Window
{
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWA_BORDER_COLOR = 34;
    private const int DWMWCP_ROUND = 2;
    private const int DWMWCP_DONOTROUND = 1;

    private const int WM_GETMINMAXINFO = 0x0024;
    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);

    private const int VK_LBUTTON = 0x01;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMaxTrackSize;
        public POINT ptMinTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }

    private readonly string _url;
    private IntPtr _hwnd;

    private enum Interaction
    {
        None,
        Move,
        Resize
    }

    private System.Windows.Threading.DispatcherTimer? _interactionTimer;
    private Interaction _interaction = Interaction.None;
    private string _edge = "";
    private POINT _startCursor;
    private double _startLeft;
    private double _startTop;
    private double _startWidth;
    private double _startHeight;

    public MainWindow(string url)
    {
        InitializeComponent();
        _url = url;

        SourceInitialized += (_, _) => ApplyChrome();
        Loaded += OnLoaded;
        StateChanged += OnStateChanged;

        WindowActions.Host = this;
    }

    private void ApplyChrome()
    {
        _hwnd = new WindowInteropHelper(this).Handle;

        var round = DWMWCP_ROUND;
        DwmSetWindowAttribute(_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, sizeof(int));

        var dark = 1;
        DwmSetWindowAttribute(_hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));

        // 纯黑描边，避免 Win11 的浅色 1px 边框破坏观感
        var border = 0;
        DwmSetWindowAttribute(_hwnd, DWMWA_BORDER_COLOR, ref border, sizeof(int));

        if (PresentationSource.FromVisual(this) is HwndSource source)
        {
            source.AddHook(WndProc);
        }
    }

    /// <summary>
    /// 无边框窗口默认按整个显示器最大化，会钻到任务栏和顶部工具条（Rainmeter / Droptop）底下。
    /// 这里把它限制在显示器工作区：最大化后不越界，也不会被顶栏压住。
    /// </summary>
    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WM_GETMINMAXINFO)
        {
            return IntPtr.Zero;
        }

        try
        {
            var mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (GetMonitorInfo(mon, ref info))
            {
                var width = info.rcWork.Right - info.rcWork.Left;
                var height = info.rcWork.Bottom - info.rcWork.Top;

                var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);
                mmi.ptMaxPosition.X = info.rcWork.Left - info.rcMonitor.Left;
                mmi.ptMaxPosition.Y = info.rcWork.Top - info.rcMonitor.Top;
                mmi.ptMaxSize.X = width;
                mmi.ptMaxSize.Y = height;

                Marshal.StructureToPtr(mmi, lParam, true);
                handled = true;
            }
        }
        catch
        {
            // 结构体对不上就交还给系统默认处理
        }

        return IntPtr.Zero;
    }

    private void OnStateChanged(object? sender, EventArgs e)
    {
        // 最大化时不用圆角，否则屏幕四角会出现奇怪缺口
        var corner = WindowState == WindowState.Maximized ? DWMWCP_DONOTROUND : DWMWCP_ROUND;
        if (_hwnd != IntPtr.Zero)
        {
            DwmSetWindowAttribute(_hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, sizeof(int));
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var dataDir = Path.Combine(AppPaths.DataDir, "WebView2");
            Directory.CreateDirectory(dataDir);

            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await View.EnsureCoreWebView2Async(env);

            var s = View.CoreWebView2.Settings;
            s.AreDefaultContextMenusEnabled = false;
            s.IsStatusBarEnabled = false;
            s.AreDevToolsEnabled = true;
            s.IsSwipeNavigationEnabled = false;
            s.IsPinchZoomEnabled = false;
            s.UserAgent = s.UserAgent + " Aurora/0.1";

            View.CoreWebView2.Navigate(_url);
        }
        catch (Exception ex)
        {
            MessageBox.Show("WebView2 初始化失败：\n" + ex.Message, "Aurora",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    public void DoDrag()
    {
        if (_interaction != Interaction.None)
        {
            return;
        }

        // 最大化时先还原成正常尺寸，让光标仍落在标题栏上的相对位置
        if (WindowState == WindowState.Maximized)
        {
            var cursorDip = CursorToDip();
            var restore = RestoreBounds;
            var width = restore.Width > 1 ? restore.Width : Width;
            var height = restore.Height > 1 ? restore.Height : Height;

            var ratio = 0.5;
            if (GetCursorPos(out var c) && GetWindowRect(_hwnd, out var maxRect))
            {
                ratio = Math.Clamp((c.X - maxRect.Left) / (double)Math.Max(1, maxRect.Right - maxRect.Left), 0.08, 0.92);
            }

            WindowState = WindowState.Normal;

            // 还原要等消息处理完才生效，之后再定位并开始拖动
            Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.Loaded, () =>
            {
                try
                {
                    var area = SystemParameters.WorkArea;
                    Left = Math.Clamp(cursorDip.X - (ratio * width), area.Left, Math.Max(area.Left, area.Right - width));
                    Top = Math.Clamp(cursorDip.Y - 26, area.Top, Math.Max(area.Top, area.Bottom - 80));
                }
                catch
                {
                    // 定位失败就从当前位置开始拖
                }

                BeginInteraction(Interaction.Move);
            });

            return;
        }

        BeginInteraction(Interaction.Move);
    }

    /// <summary>拖动窗口边缘改变大小。edge 可取 left/right/top/bottom 及其组合。</summary>
    public void StartResize(string edge)
    {
        if (_interaction != Interaction.None || WindowState == WindowState.Maximized)
        {
            return;
        }

        _edge = (edge ?? "").ToLowerInvariant();
        if (_edge.Length == 0)
        {
            return;
        }

        BeginInteraction(Interaction.Resize);
    }

    private void BeginInteraction(Interaction kind)
    {
        if (!GetCursorPos(out _startCursor))
        {
            return;
        }

        _interaction = kind;
        _startLeft = Left;
        _startTop = Top;
        _startWidth = Width;
        _startHeight = Height;

        _interactionTimer ??= new System.Windows.Threading.DispatcherTimer(
            System.Windows.Threading.DispatcherPriority.Render)
        {
            Interval = TimeSpan.FromMilliseconds(15)
        };

        _interactionTimer.Tick -= OnInteractionTick;
        _interactionTimer.Tick += OnInteractionTick;
        _interactionTimer.Start();
    }

    private void OnInteractionTick(object? sender, EventArgs e)
    {
        // 左键松开就结束
        if (_interaction == Interaction.None ||
            (GetAsyncKeyState(VK_LBUTTON) & 0x8000) == 0 ||
            !GetCursorPos(out var cursor))
        {
            EndInteraction();
            return;
        }

        var toDip = PresentationSource.FromVisual(this)?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        var from = toDip.Transform(new Point(_startCursor.X, _startCursor.Y));
        var to = toDip.Transform(new Point(cursor.X, cursor.Y));
        var dx = to.X - from.X;
        var dy = to.Y - from.Y;

        try
        {
            if (_interaction == Interaction.Move)
            {
                Left = _startLeft + dx;
                Top = _startTop + dy;
                return;
            }

            var minW = MinWidth > 0 ? MinWidth : 720;
            var minH = MinHeight > 0 ? MinHeight : 480;
            var left = _startLeft;
            var top = _startTop;
            var width = _startWidth;
            var height = _startHeight;

            if (_edge.Contains("left"))
            {
                width = Math.Max(minW, _startWidth - dx);
                left = _startLeft + (_startWidth - width);
            }

            if (_edge.Contains("right"))
            {
                width = Math.Max(minW, _startWidth + dx);
            }

            if (_edge.Contains("top"))
            {
                height = Math.Max(minH, _startHeight - dy);
                top = _startTop + (_startHeight - height);
            }

            if (_edge.Contains("bottom"))
            {
                height = Math.Max(minH, _startHeight + dy);
            }

            Left = left;
            Top = top;
            Width = width;
            Height = height;
        }
        catch
        {
            EndInteraction();
        }
    }

    private void EndInteraction()
    {
        _interaction = Interaction.None;
        _interactionTimer?.Stop();
    }

    private Point CursorToDip()
    {
        if (!GetCursorPos(out var cursor))
        {
            return new Point(Left, Top);
        }

        var source = PresentationSource.FromVisual(this);
        var toDip = source?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;
        return toDip.Transform(new Point(cursor.X, cursor.Y));
    }

    public void ToggleMaximize() =>
        WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
}

/// <summary>把 HTTP 线程上的窗口动作安全地切回 UI 线程。</summary>
public static class WindowActions
{
    public static MainWindow? Host { get; set; }

    public static void Run(Action<MainWindow> action)
    {
        var host = Host;
        if (host is null)
        {
            return;
        }

        if (host.Dispatcher.CheckAccess())
        {
            action(host);
        }
        else
        {
            host.Dispatcher.Invoke(() => action(host));
        }
    }

    /// <summary>开发/自检用：在页面里执行一段 JS 并取回结果。</summary>
    public static async Task<string> EvalAsync(string code)
    {
        var host = Host;
        if (host is null)
        {
            return "no-host";
        }

        try
        {
            return await host.Dispatcher.InvokeAsync(async () => await host.View.ExecuteScriptAsync(code)).Task.Unwrap();
        }
        catch (Exception ex)
        {
            return "eval-error: " + ex.Message;
        }
    }
}
