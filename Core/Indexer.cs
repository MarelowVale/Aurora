using System.Diagnostics;
using System.IO;
using Microsoft.Data.Sqlite;

namespace Aurora;

public sealed class IndexStatus
{
    public string State { get; set; } = "idle";   // idle | scanning | done | error
    public long Scanned { get; set; }
    public long Total { get; set; }
    public string? Message { get; set; }
    public long StartedAt { get; set; }
    public long FinishedAt { get; set; }
    public long LastFullScan { get; set; }
    public bool Stale { get; set; } = true;
}

/// <summary>
/// 文件名索引。真文件永远在磁盘上，这里只是可随时重建的缓存。
/// </summary>
public sealed class Indexer
{
    private static readonly string[] SkipDirs =
    {
        @"$RECYCLE.BIN", "System Volume Information", "$WinREAgent", "Config.Msi",
        "$SysReset", "$Windows.~WS", "$Windows.~BT", "Recovery",
    };

    private readonly Store _store;
    private readonly object _gate = new();
    private readonly IndexStatus _status = new();
    private CancellationTokenSource? _cts;
    private Task? _worker;

    public Indexer(Store store)
    {
        _store = store;
        using var conn = Open();
        Exec(conn, """
            CREATE TABLE IF NOT EXISTS files(
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                nl TEXT NOT NULL,
                ext TEXT NOT NULL,
                dir INTEGER NOT NULL,
                size INTEGER NOT NULL,
                mtime INTEGER NOT NULL,
                ctime INTEGER NOT NULL,
                hidden INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_files_nl ON files(nl);
            CREATE INDEX IF NOT EXISTS ix_files_mtime ON files(mtime DESC);
            CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
            """);

        var last = GetMeta(conn, "last_full_scan");
        if (long.TryParse(last, out var ticks))
        {
            _status.LastFullScan = ticks;
            _status.Stale = (DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc)).TotalHours > 6;
        }
        else
        {
            _status.Stale = true;
        }

        // 启动时把已收录条目数读出来，界面上不必等一次扫描就能看到真实数量
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM files";
            _status.Total = Convert.ToInt64(cmd.ExecuteScalar() ?? 0L);
            _status.Scanned = _status.Total;
        }
        catch { /* 索引只是缓存，读不出来就走重建流程 */ }
    }

    public IndexStatus Status
    {
        get
        {
            lock (_gate)
            {
                return new IndexStatus
                {
                    State = _status.State,
                    Scanned = _status.Scanned,
                    Total = _status.Total,
                    Message = _status.Message,
                    StartedAt = _status.StartedAt,
                    FinishedAt = _status.FinishedAt,
                    LastFullScan = _status.LastFullScan,
                    Stale = _status.Stale,
                };
            }
        }
    }

    private static SqliteConnection Open()
    {
        var conn = new SqliteConnection($"Data Source={AppPaths.DbPath};Cache=Shared");
        conn.Open();
        using var pragma = conn.CreateCommand();
        pragma.CommandText = """
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            PRAGMA temp_store=MEMORY;
            PRAGMA cache_size=-65536;
            """;
        pragma.ExecuteNonQuery();
        return conn;
    }

    private static void Exec(SqliteConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static string? GetMeta(SqliteConnection conn, string key)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT v FROM meta WHERE k=$k";
        cmd.Parameters.AddWithValue("$k", key);
        return cmd.ExecuteScalar() as string;
    }

    private static void SetMeta(SqliteConnection conn, string key, string value)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO meta(k,v) VALUES($k,$v) ON CONFLICT(k) DO UPDATE SET v=$v";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value);
        cmd.ExecuteNonQuery();
    }

    public void Rebuild()
    {
        Stop();
        _cts = new CancellationTokenSource();
        var token = _cts.Token;
        _worker = Task.Run(() => RunScan(token), token);
    }

    public void Stop()
    {
        try
        {
            _cts?.Cancel();
            _worker?.Wait(1500);
        }
        catch
        {
            // 忽略
        }
    }

    public void Dispose()
    {
        Stop();
        _cts?.Dispose();
    }

    private void RunScan(CancellationToken token)
    {
        var sw = Stopwatch.StartNew();
        lock (_gate)
        {
            _status.State = "scanning";
            _status.Scanned = 0;
            _status.Total = 0;
            _status.Message = null;
            _status.StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        try
        {
            using var conn = Open();
            Exec(conn, "DELETE FROM files");
            Exec(conn, "BEGIN");

            var insert = conn.CreateCommand();
            insert.CommandText = """
                INSERT OR IGNORE INTO files(path,name,nl,ext,dir,size,mtime,ctime,hidden)
                VALUES($p,$n,$nl,$e,$d,$s,$m,$c,$h)
                """;
            var pP = insert.Parameters.Add("$p", SqliteType.Text);
            var pN = insert.Parameters.Add("$n", SqliteType.Text);
            var pNL = insert.Parameters.Add("$nl", SqliteType.Text);
            var pE = insert.Parameters.Add("$e", SqliteType.Text);
            var pD = insert.Parameters.Add("$d", SqliteType.Integer);
            var pS = insert.Parameters.Add("$s", SqliteType.Integer);
            var pM = insert.Parameters.Add("$m", SqliteType.Integer);
            var pC = insert.Parameters.Add("$c", SqliteType.Integer);
            var pH = insert.Parameters.Add("$h", SqliteType.Integer);

            var roots = _store.Settings.Roots.Count > 0
                ? _store.Settings.Roots
                : new List<string> { @"D:\" };

            var batch = 0;
            var options = new EnumerationOptions
            {
                IgnoreInaccessible = true,
                AttributesToSkip = 0,
                RecurseSubdirectories = false,
                ReturnSpecialDirectories = false,
            };

            foreach (var root in roots)
            {
                if (!Directory.Exists(root))
                {
                    continue;
                }

                // 广度优先，避免深层递归爆栈
                var queue = new Queue<string>();
                queue.Enqueue(root);
                while (queue.Count > 0)
                {
                    token.ThrowIfCancellationRequested();
                    var dir = queue.Dequeue();
                    IEnumerable<FileSystemInfo> children;
                    try
                    {
                        children = new DirectoryInfo(dir).EnumerateFileSystemInfos("*", options);
                    }
                    catch
                    {
                        continue;
                    }

                    foreach (var fsi in children)
                    {
                        token.ThrowIfCancellationRequested();
                        FileAttributes attrs;
                        try
                        {
                            attrs = fsi.Attributes;
                        }
                        catch
                        {
                            continue;
                        }

                        var isDir = (attrs & FileAttributes.Directory) != 0;
                        var name = fsi.Name;
                        if (isDir)
                        {
                            if (SkipDirs.Contains(name, StringComparer.OrdinalIgnoreCase))
                            {
                                continue;
                            }

                            queue.Enqueue(fsi.FullName);
                        }
                        else if ((attrs & (FileAttributes.System | FileAttributes.Temporary)) != 0 &&
                                 (attrs & FileAttributes.Hidden) != 0)
                        {
                            // 系统隐藏文件不入索引，减少噪音
                            continue;
                        }

                        long size = 0, mtime = 0, ctime = 0;
                        try
                        {
                            if (!isDir && fsi is FileInfo fi)
                            {
                                size = fi.Length;
                            }

                            mtime = new DateTimeOffset(fsi.LastWriteTimeUtc).ToUnixTimeMilliseconds();
                            ctime = new DateTimeOffset(fsi.CreationTimeUtc).ToUnixTimeMilliseconds();
                        }
                        catch
                        {
                            // 用默认值
                        }

                        pP.Value = fsi.FullName;
                        pN.Value = name;
                        pNL.Value = name.ToLowerInvariant();
                        pE.Value = isDir ? "" : Path.GetExtension(name);
                        pD.Value = isDir ? 1 : 0;
                        pS.Value = size;
                        pM.Value = mtime;
                        pC.Value = ctime;
                        pH.Value = (attrs & FileAttributes.Hidden) != 0 ? 1 : 0;
                        insert.ExecuteNonQuery();

                        if (++batch % 4000 == 0)
                        {
                            Exec(conn, "COMMIT");
                            Exec(conn, "BEGIN");
                            lock (_gate)
                            {
                                _status.Scanned = batch;
                            }
                        }
                    }
                }
            }

            Exec(conn, "COMMIT");
            Exec(conn, "ANALYZE");

            using (var count = conn.CreateCommand())
            {
                count.CommandText = "SELECT COUNT(*) FROM files";
                var total = Convert.ToInt64(count.ExecuteScalar());
                lock (_gate)
                {
                    _status.Total = total;
                }
            }

            var now = DateTime.UtcNow;
            SetMeta(conn, "last_full_scan", now.Ticks.ToString());

            lock (_gate)
            {
                _status.State = "done";
                _status.Scanned = batch;
                _status.Total = batch;
                _status.FinishedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                _status.LastFullScan = now.Ticks;
                _status.Stale = false;
                _status.Message = $"{batch:N0} 个条目，用时 {sw.Elapsed.TotalSeconds:0.0}s";
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
            {
                _status.State = "idle";
                _status.Message = "已取消";
            }
        }
        catch (Exception ex)
        {
            AppPaths.Log("索引失败：" + ex);
            lock (_gate)
            {
                _status.State = "error";
                _status.Message = ex.Message;
            }
        }
    }

    // ---------- 查询 ----------

    private const string Cols = "path,name,ext,dir,size,mtime,ctime,hidden";

    private static FsEntry Read(SqliteDataReader r) => new()
    {
        Path = r.GetString(0),
        Name = r.GetString(1),
        Ext = r.GetString(2),
        IsDir = r.GetInt64(3) != 0,
        Size = r.GetInt64(4),
        MTime = r.GetInt64(5),
        CTime = r.GetInt64(6),
        Hidden = r.GetInt64(7) != 0,
        Kind = r.GetInt64(3) != 0 ? "folder" : Kinds.Of(r.GetString(2)),
    };

    /// <summary>搜索：先用索引命中前缀，再用包含匹配补齐，最后按长度与时间排序。</summary>
    public List<FsEntry> Search(string query, int limit = 200)
    {
        var q = query.Trim().ToLowerInvariant();
        if (q.Length == 0)
        {
            return new List<FsEntry>();
        }

        var result = new List<FsEntry>(limit);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var conn = Open();

        void Add(IEnumerable<FsEntry> items)
        {
            foreach (var e in items)
            {
                if (result.Count >= limit)
                {
                    return;
                }

                if (seen.Add(e.Path))
                {
                    result.Add(e);
                }
            }
        }

        // 1) 前缀（走索引，最快）
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"""
                SELECT {Cols} FROM files
                WHERE nl >= $q AND nl < $q || char(1114111)
                ORDER BY dir DESC, length(name) LIMIT $lim
                """;
            cmd.Parameters.AddWithValue("$q", q);
            cmd.Parameters.AddWithValue("$lim", limit);
            using var r = cmd.ExecuteReader();
            while (r.Read()) Add(new[] { Read(r) });
        }

        // 2) 包含（全表扫描，但只在前缀结果不够时补）
        if (result.Count < limit)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                SELECT {Cols} FROM files
                WHERE nl LIKE $like
                ORDER BY dir DESC, length(name), mtime DESC LIMIT $lim
                """;
            cmd.Parameters.AddWithValue("$like", "%" + q + "%");
            cmd.Parameters.AddWithValue("$lim", limit);
            using var r = cmd.ExecuteReader();
            while (r.Read()) Add(new[] { Read(r) });
        }

        return result;
    }

    public List<FsEntry> Recents(int limit = 60)
    {
        var list = new List<FsEntry>(limit);
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {Cols} FROM files WHERE dir=0 ORDER BY mtime DESC LIMIT $lim";
        cmd.Parameters.AddWithValue("$lim", limit);
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            list.Add(Read(r));
        }

        return list;
    }

    public long CountIn(string directory)
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM files WHERE path LIKE $p";
        cmd.Parameters.AddWithValue("$p", directory.TrimEnd('\\') + "\\%");
        return Convert.ToInt64(cmd.ExecuteScalar());
    }
}
