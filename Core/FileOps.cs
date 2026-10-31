using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace Aurora;

public sealed record OpResult(bool Ok, string? Error = null, string? Path = null, int Count = 0);

/// <summary>文件操作。全部走系统 API，回收站由 Shell 负责。</summary>
public static class FileOps
{
    private const uint FO_DELETE = 0x0003;
    private const ushort FOF_SILENT = 0x0004;
    private const ushort FOF_NOCONFIRMATION = 0x0010;
    private const ushort FOF_ALLOWUNDO = 0x0040;
    private const ushort FOF_NOERRORUI = 0x0400;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd;
        public uint wFunc;
        [MarshalAs(UnmanagedType.LPWStr)] public string pFrom;
        [MarshalAs(UnmanagedType.LPWStr)] public string? pTo;
        public ushort fFlags;
        public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperation(ref SHFILEOPSTRUCT lpFileOp);

    public static OpResult Mkdir(string parent, string name)
    {
        try
        {
            var target = Path.Combine(parent, name);
            if (Directory.Exists(target) || File.Exists(target))
            {
                target = UniquePath(target, isDir: true);
            }

            Directory.CreateDirectory(target);
            return new OpResult(true, Path: target, Count: 1);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    public static OpResult Rename(string path, string newName)
    {
        try
        {
            var parent = Path.GetDirectoryName(path);
            if (string.IsNullOrEmpty(parent))
            {
                return new OpResult(false, "无法重命名磁盘根目录");
            }

            var target = Path.Combine(parent, newName.Trim());
            if (string.Equals(target, path, StringComparison.OrdinalIgnoreCase))
            {
                return new OpResult(true, Path: path);
            }

            if (File.Exists(target) || Directory.Exists(target))
            {
                return new OpResult(false, "同名项目已存在");
            }

            if (Directory.Exists(path))
            {
                Directory.Move(path, target);
            }
            else
            {
                File.Move(path, target);
            }

            return new OpResult(true, Path: target, Count: 1);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    public static OpResult Copy(IEnumerable<string> paths, string targetDir, bool move)
    {
        var count = 0;
        var errors = new List<string>();
        foreach (var src in paths)
        {
            try
            {
                if (!File.Exists(src) && !Directory.Exists(src))
                {
                    continue;
                }

                var name = Path.GetFileName(src.TrimEnd('\\'));
                var dest = Path.Combine(targetDir, name);

                // 目标是自己或自己的子目录：跳过，防递归爆炸
                if (Directory.Exists(src) && dest.StartsWith(src.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase))
                {
                    errors.Add($"{name}：不能复制到自身内部");
                    continue;
                }

                if (File.Exists(dest) || Directory.Exists(dest))
                {
                    dest = UniquePath(dest, Directory.Exists(src));
                }

                if (move)
                {
                    if (Directory.Exists(src))
                    {
                        try
                        {
                            Directory.Move(src, dest);
                        }
                        catch (IOException)
                        {
                            CopyDir(src, dest);
                            Directory.Delete(src, true);
                        }
                    }
                    else
                    {
                        File.Move(src, dest);
                    }
                }
                else
                {
                    if (Directory.Exists(src))
                    {
                        CopyDir(src, dest);
                    }
                    else
                    {
                        File.Copy(src, dest);
                    }
                }

                count++;
            }
            catch (Exception ex)
            {
                errors.Add(Path.GetFileName(src) + "：" + ex.Message);
            }
        }

        return errors.Count == 0
            ? new OpResult(true, Path: targetDir, Count: count)
            : new OpResult(count > 0, string.Join("\n", errors), targetDir, count);
    }

    private static void CopyDir(string src, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.EnumerateFiles(src))
        {
            File.Copy(file, Path.Combine(dest, Path.GetFileName(file)));
        }

        foreach (var dir in Directory.EnumerateDirectories(src))
        {
            CopyDir(dir, Path.Combine(dest, Path.GetFileName(dir)));
        }
    }

    private static string UniquePath(string path, bool isDir)
    {
        var parent = Path.GetDirectoryName(path) ?? "";
        var stem = isDir ? path : Path.GetFileNameWithoutExtension(path);
        var ext = isDir ? "" : Path.GetExtension(path);
        stem = isDir ? Path.GetFileName(path) : Path.GetFileNameWithoutExtension(path);

        for (var i = 2; i < 1000; i++)
        {
            var candidate = Path.Combine(parent, $"{stem} ({i}){ext}");
            if (!File.Exists(candidate) && !Directory.Exists(candidate))
            {
                return candidate;
            }
        }

        return Path.Combine(parent, $"{stem} ({Guid.NewGuid():N}){ext}");
    }

    /// <summary>移到回收站（可撤销）。</summary>
    public static OpResult Trash(IEnumerable<string> paths)
    {
        var list = paths.Where(p => File.Exists(p) || Directory.Exists(p)).ToList();
        if (list.Count == 0)
        {
            return new OpResult(false, "没有可删除的项目");
        }

        var op = new SHFILEOPSTRUCT
        {
            wFunc = FO_DELETE,
            pFrom = string.Join("\0", list) + "\0\0",
            fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        };

        var code = SHFileOperation(ref op);
        return code == 0 && !op.fAnyOperationsAborted
            ? new OpResult(true, Count: list.Count)
            : new OpResult(false, "删除失败，代码 " + code);
    }

    public static OpResult Delete(IEnumerable<string> paths)
    {
        var count = 0;
        var errors = new List<string>();
        foreach (var p in paths)
        {
            try
            {
                if (Directory.Exists(p))
                {
                    Directory.Delete(p, true);
                }
                else if (File.Exists(p))
                {
                    var attrs = File.GetAttributes(p);
                    if ((attrs & FileAttributes.ReadOnly) != 0)
                    {
                        File.SetAttributes(p, attrs & ~FileAttributes.ReadOnly);
                    }

                    File.Delete(p);
                }

                count++;
            }
            catch (Exception ex)
            {
                errors.Add(Path.GetFileName(p) + "：" + ex.Message);
            }
        }

        return errors.Count == 0
            ? new OpResult(true, Count: count)
            : new OpResult(count > 0, string.Join("\n", errors), Count: count);
    }

    public static OpResult Open(string path)
    {
        try
        {
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            return new OpResult(true);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    public static OpResult Reveal(string path)
    {
        try
        {
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
            return new OpResult(true);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    /// <summary>在指定目录打开一个终端窗口：优先 Windows Terminal，回退到 cmd。</summary>
    public static OpResult OpenTerminal(string dir)
    {
        try
        {
            var workDir = dir;
            if (!Directory.Exists(workDir)) workDir = Path.GetDirectoryName(workDir) ?? "";
            if (!Directory.Exists(workDir)) workDir = @"D:\";

            var wt = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                @"Microsoft\WindowsApps\wt.exe");

            if (File.Exists(wt))
            {
                Process.Start(new ProcessStartInfo(wt, $"-d \"{workDir}\"") { UseShellExecute = true });
            }
            else
            {
                Process.Start(new ProcessStartInfo("cmd.exe", $"/c start \"\" cmd.exe /k cd /d \"{workDir}\"")
                {
                    UseShellExecute = true,
                    WorkingDirectory = workDir,
                });
            }

            return new OpResult(true, null, workDir, 0);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    public static OpResult OpenWith(string path)
    {        try
        {
            Process.Start(new ProcessStartInfo("rundll32.exe", $"shell32.dll,OpenAs_RunDLL \"{path}\"")
            {
                UseShellExecute = true,
            });
            return new OpResult(true);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    public static OpResult ShowProperties(string path)
    {
        try
        {
            var info = new NativeShFileInfo
            {
                cbSize = Marshal.SizeOf<NativeShFileInfo>(),
            };
            SHGetFileInfo(path, 0, ref info, (uint)info.cbSize, 0x000000400);
            var rect = new NativeRect();
            GetWindowRect(GetShellWindow(), ref rect);
            ShellExecute(IntPtr.Zero, "properties", path, null, null, 5);
            return new OpResult(true);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeShFileInfo
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
        public int cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int left, top, right, bottom;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr ShellExecute(IntPtr hwnd, string op, string file, string? parameters,
        string? directory, int showCmd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, ref NativeRect rect);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(string path, uint attrs, ref NativeShFileInfo info, uint cb, uint flags);
}
