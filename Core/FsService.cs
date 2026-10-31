using System.IO;
using System.Text;
using System.Windows.Media.Imaging;

namespace Aurora;

public sealed record DriveInfoDto(string Path, string Label, string Format, long Total, long Free, bool Ready);

public sealed record ListResult(
    string Path,
    string? Parent,
    string Name,
    List<FsEntry> Entries,
    int Count,
    long Total,
    long Free,
    bool Truncated);

public sealed class PreviewResult
{
    public string Kind { get; set; } = "none";
    public string? Text { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public long Size { get; set; }
    public string? Mime { get; set; }
    public int? Lines { get; set; }
    public bool Truncated { get; set; }
}

/// <summary>目录列举、盘符信息、预览。全部只读、无副作用。</summary>
public sealed class FsService
{
    private const int MaxEntries = 20000;

    public List<DriveInfoDto> Drives()
    {
        var list = new List<DriveInfoDto>();
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                var ready = d.IsReady;
                list.Add(new DriveInfoDto(
                    d.Name.TrimEnd('\\'),
                    ready ? d.VolumeLabel : "",
                    ready ? d.DriveFormat : "",
                    ready ? d.TotalSize : 0,
                    ready ? d.AvailableFreeSpace : 0,
                    ready));
            }
            catch
            {
                // 光驱等可能抛异常
            }
        }

        return list;
    }

    public ListResult List(string dir, string sort, bool desc, bool showHidden)
    {
        var full = PathUtil.Norm(dir) ?? @"D:\";
        var entries = new List<FsEntry>();
        var truncated = false;
        var options = new EnumerationOptions
        {
            IgnoreInaccessible = true,
            AttributesToSkip = 0,
            ReturnSpecialDirectories = false,
        };

        try
        {
            var info = new DirectoryInfo(full);
            if (!info.Exists)
            {
                return new ListResult(full, null, full, entries, 0, 0, 0, false);
            }

            foreach (var fsi in info.EnumerateFileSystemInfos("*", options))
            {
                if (entries.Count >= MaxEntries)
                {
                    truncated = true;
                    break;
                }

                var e = PathUtil.From(fsi);
                if (!showHidden && (e.Hidden || fsi.Name.StartsWith('.')))
                {
                    continue;
                }

                entries.Add(e);
            }
        }
        catch (Exception ex)
        {
            AppPaths.Log("列举失败 " + full + " : " + ex.Message);
        }

        entries.Sort(PathUtil.ForField(sort, desc));

        long total = 0, free = 0;
        try
        {
            var root = Path.GetPathRoot(full);
            if (!string.IsNullOrEmpty(root))
            {
                var di = new DriveInfo(root);
                if (di.IsReady)
                {
                    total = di.TotalSize;
                    free = di.AvailableFreeSpace;
                }
            }
        }
        catch
        {
            // 忽略
        }

        var parent = Directory.GetParent(full)?.FullName;
        var name = string.IsNullOrEmpty(Path.GetFileName(full)) ? full : Path.GetFileName(full);

        return new ListResult(full, parent, name, entries, entries.Count, total, free, truncated);
    }

    public List<FsEntry> ChildrenDirs(string dir)
    {
        var list = new List<FsEntry>();
        try
        {
            foreach (var d in new DirectoryInfo(dir).EnumerateDirectories())
            {
                var e = PathUtil.From(d);
                if (e.Hidden)
                {
                    continue;
                }

                list.Add(e);
            }
        }
        catch
        {
            // 权限
        }

        list.Sort(PathUtil.ByName);
        return list;
    }

    public PreviewResult Preview(string path)
    {
        var result = new PreviewResult();
        var full = PathUtil.Norm(path);
        if (full is null)
        {
            return result;
        }

        if (Directory.Exists(full))
        {
            result.Kind = "folder";
            return result;
        }

        if (!File.Exists(full))
        {
            return result;
        }

        var fi = new FileInfo(full);
        result.Size = fi.Length;
        var ext = fi.Extension.ToLowerInvariant();

        if (Kinds.IsImage(ext) && fi.Length < 80L * 1024 * 1024)
        {
            try
            {
                using var fs = File.OpenRead(full);
                var decoder = BitmapDecoder.Create(fs, BitmapCreateOptions.DelayCreation,
                    BitmapCacheOption.None);
                var frame = decoder.Frames[0];
                result.Kind = "image";
                result.Width = frame.PixelWidth;
                result.Height = frame.PixelHeight;
                return result;
            }
            catch
            {
                // 继续按文本试
            }
        }

        if (Kinds.IsText(ext) && fi.Length < 4L * 1024 * 1024)
        {
            try
            {
                var buffer = new byte[(int)Math.Min(fi.Length, 256 * 1024)];
                using (var fs = File.OpenRead(full))
                {
                    fs.ReadExactly(buffer, 0, buffer.Length);
                }

                if (!LooksBinary(buffer))
                {
                    var text = Decode(buffer);
                    result.Kind = "text";
                    result.Text = text;
                    result.Lines = text.Count(c => c == '\n') + 1;
                    result.Truncated = fi.Length > buffer.Length;
                    result.Mime = ext switch
                    {
                        ".json" => "application/json",
                        ".md" => "text/markdown",
                        ".html" or ".htm" => "text/html",
                        ".css" => "text/css",
                        ".js" => "text/javascript",
                        _ => "text/plain",
                    };
                    return result;
                }
            }
            catch
            {
                // 继续
            }
        }

        result.Kind = "binary";
        return result;
    }

    private static bool LooksBinary(byte[] buffer)
    {
        var n = Math.Min(buffer.Length, 4096);
        for (var i = 0; i < n; i++)
        {
            if (buffer[i] == 0)
            {
                return true;
            }
        }

        return false;
    }

    private static string Decode(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
        {
            return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
        }

        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
        {
            return Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
        }

        if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
        {
            return Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);
        }

        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>桌面壁纸路径，前端拿来做毛玻璃底图。</summary>
    public string? Wallpaper()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop");
            var value = key?.GetValue("WallPaper") as string;
            if (!string.IsNullOrEmpty(value) && File.Exists(value))
            {
                return value;
            }

            var transcoded = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                @"Microsoft\Windows\Themes\TranscodedWallpaper");
            return File.Exists(transcoded) ? transcoded : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>递归统计大小，给"属性"面板用。带条目上限防止卡死。</summary>
    public (long size, int files, int dirs) FolderSize(string path, CancellationToken ct)
    {
        long size = 0;
        int files = 0, dirs = 0;
        var stack = new Stack<string>();
        stack.Push(path);
        var options = new EnumerationOptions { IgnoreInaccessible = true, RecurseSubdirectories = false };

        while (stack.Count > 0 && files < 200000)
        {
            ct.ThrowIfCancellationRequested();
            var dir = stack.Pop();
            try
            {
                foreach (var f in new DirectoryInfo(dir).EnumerateFiles("*", options))
                {
                    size += f.Length;
                    files++;
                }

                foreach (var d in new DirectoryInfo(dir).EnumerateDirectories("*", options))
                {
                    dirs++;
                    stack.Push(d.FullName);
                }
            }
            catch
            {
                // 跳过无权限目录
            }
        }

        return (size, files, dirs);
    }
}
