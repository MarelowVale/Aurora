using System.IO;

namespace Aurora;

/// <summary>所有运行期数据都放在 LocalAppData，程序目录保持干净、可整体拷走。</summary>
public static class AppPaths
{
    public static string DataDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aurora");

    public static string SettingsPath => Path.Combine(DataDir, "settings.json");
    public static string SecretsPath => Path.Combine(DataDir, "secrets.bin");
    public static string DbPath => Path.Combine(DataDir, "index.db");
    public static string ThumbDir => Path.Combine(DataDir, "thumbs");
    public static string LogPath => Path.Combine(DataDir, "aurora.log");

    public static void Ensure()
    {
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(ThumbDir);
    }

    public static void Log(string message)
    {
        try
        {
            File.AppendAllText(LogPath,
                $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
        }
        catch
        {
            // 日志失败不影响主流程
        }
    }
}
