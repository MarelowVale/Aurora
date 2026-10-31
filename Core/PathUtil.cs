using System.IO;

namespace Aurora;

public static class PathUtil
{
    /// <summary>去掉引号、统一分隔符、转成绝对路径。非法路径返回 null。</summary>
    public static string? Norm(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var p = raw.Trim().Trim('"').Trim();
        if (p.Length == 0)
        {
            return null;
        }

        try
        {
            return Path.GetFullPath(p);
        }
        catch
        {
            return null;
        }
    }

    public static bool IsDriveRoot(string path)
    {
        var p = Path.GetFullPath(path);
        return p.Length <= 3 && p.Length >= 2 && p[1] == ':';
    }

    public static string DriveOf(string path) => path.Length >= 2 ? path[..2].ToUpperInvariant() : "";

    /// <summary>把 FileSystemInfo 转成前端条目。</summary>
    public static FsEntry From(FileSystemInfo fsi)
    {
        var entry = new FsEntry { Path = fsi.FullName, Name = fsi.Name };
        try
        {
            var attrs = fsi.Attributes;
            entry.IsDir = (attrs & FileAttributes.Directory) != 0;
            entry.Hidden = (attrs & FileAttributes.Hidden) != 0;
            entry.ReadOnly = (attrs & FileAttributes.ReadOnly) != 0;
            entry.Link = (attrs & FileAttributes.ReparsePoint) != 0;

            if (!entry.IsDir && fsi is FileInfo fi)
            {
                entry.Size = fi.Length;
            }

            entry.MTime = new DateTimeOffset(fsi.LastWriteTimeUtc).ToUnixTimeMilliseconds();
            entry.CTime = new DateTimeOffset(fsi.CreationTimeUtc).ToUnixTimeMilliseconds();
        }
        catch
        {
            // 权限不足或文件刚被删：返回能拿到的部分
        }

        entry.Ext = entry.IsDir ? "" : Path.GetExtension(entry.Name).ToLowerInvariant();
        entry.Kind = entry.IsDir ? "folder" : Kinds.Of(entry.Ext);
        return entry;
    }

    public static string HumanSize(long bytes)
    {
        if (bytes < 1024) return bytes + " B";
        string[] units = { "KB", "MB", "GB", "TB", "PB" };
        double v = bytes;
        var i = -1;
        do
        {
            v /= 1024;
            i++;
        } while (v >= 1024 && i < units.Length - 1);

        return v.ToString(v >= 100 ? "0" : v >= 10 ? "0.0" : "0.00") + " " + units[i];
    }

    /// <summary>自然排序：把数字段当数值比较，"文件2" &lt; "文件10"。</summary>
    public static int NaturalCompare(string a, string b)
    {
        int i = 0, j = 0;
        while (i < a.Length && j < b.Length)
        {
            if (char.IsDigit(a[i]) && char.IsDigit(b[j]))
            {
                int si = i, sj = j;
                while (i < a.Length && char.IsDigit(a[i])) i++;
                while (j < b.Length && char.IsDigit(b[j])) j++;
                var na = a.AsSpan(si, i - si).TrimStart('0');
                var nb = b.AsSpan(sj, j - sj).TrimStart('0');
                if (na.Length != nb.Length)
                {
                    return na.Length - nb.Length;
                }

                var cmp = na.SequenceCompareTo(nb);
                if (cmp != 0)
                {
                    return cmp;
                }
            }
            else
            {
                var ca = char.ToUpperInvariant(a[i]);
                var cb = char.ToUpperInvariant(b[j]);
                if (ca != cb)
                {
                    return ca.CompareTo(cb);
                }

                i++;
                j++;
            }
        }

        return (a.Length - i).CompareTo(b.Length - j);
    }

    public static readonly IComparer<FsEntry> ByName = Comparer<FsEntry>.Create((x, y) =>
    {
        if (x.IsDir != y.IsDir)
        {
            return x.IsDir ? -1 : 1;
        }

        return NaturalCompare(x.Name, y.Name);
    });

    public static IComparer<FsEntry> ForField(string field, bool desc)
    {
        int Base(FsEntry x, FsEntry y) => field switch
        {
            "size" => x.IsDir == y.IsDir
                ? x.Size.CompareTo(y.Size)
                : x.IsDir ? -1 : 1,
            "mtime" => x.MTime.CompareTo(y.MTime),
            "ctime" => x.CTime.CompareTo(y.CTime),
            "kind" => x.IsDir == y.IsDir
                ? string.Compare(Kinds.Of(x.Ext) + x.Ext, Kinds.Of(y.Ext) + y.Ext, StringComparison.OrdinalIgnoreCase)
                : x.IsDir ? -1 : 1,
            _ => 0,
        };

        return Comparer<FsEntry>.Create((x, y) =>
        {
            if (field is "size" or "mtime" or "ctime" or "kind")
            {
                var c = Base(x, y);
                if (c != 0) return desc ? -c : c;
            }

            var n = ByName.Compare(x, y);
            return desc && field == "name" ? -n : n;
        });
    }
}
