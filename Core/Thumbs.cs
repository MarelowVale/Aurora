using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace Aurora;

/// <summary>用系统 Shell 缩略图接口拿真实预览（图片/视频/PDF），失败则回退到文件图标。</summary>
public sealed class Thumbs
{
    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE
    {
        public int cx;
        public int cy;
    }

    [Flags]
    private enum SIIGBF
    {
        RESIZETOFIT = 0x00,
        BIGGERSIZEOK = 0x01,
        MEMORYONLY = 0x02,
        ICONONLY = 0x04,
        THUMBNAILONLY = 0x08,
        INCACHEONLY = 0x10,
    }

    [ComImport]
    [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig]
        int GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(
        string path, IntPtr pbc, ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out object ppv);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    private static readonly Guid IID_IShellItemImageFactory =
        new("bcc18b79-ba16-442f-80c4-8a59c30c463b");

    private readonly object _gate = new();

    public byte[]? Get(string path, int size, long mtime, long fileSize)
    {
        size = Math.Clamp(size, 16, 512);
        var key = Hash($"{path.ToLowerInvariant()}|{mtime}|{fileSize}|{size}");
        var cache = Path.Combine(AppPaths.ThumbDir, key + ".png");

        try
        {
            if (File.Exists(cache))
            {
                var info = new FileInfo(cache);
                if (info.Length > 0 && DateTime.UtcNow - info.LastWriteTimeUtc < TimeSpan.FromDays(30))
                {
                    return File.ReadAllBytes(cache);
                }
            }
        }
        catch
        {
            // 缓存坏了就重新生成
        }

        var bytes = Render(path, size);
        if (bytes is null)
        {
            return null;
        }

        try
        {
            lock (_gate)
            {
                File.WriteAllBytes(cache, bytes);
            }
        }
        catch
        {
            // 写缓存失败不影响返回
        }

        return bytes;
    }

    private static string Hash(string input)
    {
        var hash = SHA1.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(hash)[..24].ToLowerInvariant();
    }

    private static byte[]? Render(string path, int size)
    {
        try
        {
            var iid = IID_IShellItemImageFactory;
            SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out var obj);
            if (obj is not IShellItemImageFactory factory)
            {
                return null;
            }

            var hbm = IntPtr.Zero;
            var hr = factory.GetImage(new SIZE { cx = size, cy = size },
                SIIGBF.THUMBNAILONLY | SIIGBF.BIGGERSIZEOK, out hbm);

            if (hr != 0 || hbm == IntPtr.Zero)
            {
                // 没有真缩略图，退一步取大图标（exe、快捷方式这类）
                hr = factory.GetImage(new SIZE { cx = size, cy = size },
                    SIIGBF.ICONONLY | SIIGBF.BIGGERSIZEOK, out hbm);
            }

            if (hr != 0 || hbm == IntPtr.Zero)
            {
                return null;
            }

            try
            {
                var source = Imaging.CreateBitmapSourceFromHBitmap(
                    hbm, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
                source.Freeze();

                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(source));
                using var ms = new MemoryStream();
                encoder.Save(ms);
                return ms.ToArray();
            }
            finally
            {
                DeleteObject(hbm);
            }
        }
        catch (Exception ex)
        {
            AppPaths.Log("缩略图失败 " + path + " : " + ex.Message);
            return null;
        }
    }
}
