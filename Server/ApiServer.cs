using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging;

namespace Aurora.Web;

/// <summary>
/// 只监听 127.0.0.1 的随机端口，全部接口都要 token。
/// 前端是纯静态文件，任何外部网页都拿不到 token，也就无法调用这些接口。
/// </summary>
public sealed class ApiServer : IAsyncDisposable
{
    private WebApplication? _app;
    private AppState? _state;

    public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    public string BaseUrl { get; private set; } = "";

    /// <summary>程序版本，取自 csproj 的 &lt;Version&gt;。</summary>
    public static string AppVersion { get; } =
        (typeof(ApiServer).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
         ?? typeof(ApiServer).Assembly.GetName().Version?.ToString(3)
         ?? "1.0.0").Split('+')[0];

    public static async Task<ApiServer> StartAsync(AppState state)
    {
        var server = new ApiServer();
        await server.StartCoreAsync(state);
        return server;
    }

    private async Task StartCoreAsync(AppState state)
    {
        _state = state;

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ContentRootPath = AppContext.BaseDirectory,
        });

        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");

        var app = builder.Build();

        // 防止被别的站点用 DNS rebinding 摸到
        app.Use(async (ctx, next) =>
        {
            var host = ctx.Request.Host.Host;
            if (host is not ("127.0.0.1" or "localhost" or "[::1]"))
            {
                ctx.Response.StatusCode = 403;
                return;
            }

            await next();
        });

        app.Use(async (ctx, next) =>
        {
            var path = ctx.Request.Path.Value ?? "";
            if (!path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            {
                await next();
                return;
            }

            var token = ctx.Request.Query["t"].ToString();
            if (string.IsNullOrEmpty(token))
            {
                token = ctx.Request.Headers["X-Aurora-Token"].ToString();
            }

            if (!string.Equals(token, Token, StringComparison.Ordinal))
            {
                ctx.Response.StatusCode = 401;
                await ctx.Response.WriteAsync("unauthorized");
                return;
            }

            await next();
        });

        var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
        var provider = new PhysicalFileProvider(webRoot);
        app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = provider });
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = provider,
            // 前端资源改动后（尤其 WebView2 的磁盘缓存）要能立刻看到，这里不让它强缓存
            OnPrepareResponse = ctx =>
            {
                ctx.Context.Response.Headers.CacheControl = "no-cache, max-age=0";
            },
        });

        MapApi(app);

        await app.StartAsync();

        var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>();
        BaseUrl = addresses?.Addresses.FirstOrDefault() ?? "http://127.0.0.1:0";
        _app = app;
    }

    private void MapApi(WebApplication app)
    {
        var state = _state!;

        // ---------- 初始化 ----------
        app.MapGet("/api/bootstrap", () =>
        {
            var s = state.Store.Settings;
            return Results.Ok(new
            {
                app = "Aurora",
                version = AppVersion,
                installPath = AppContext.BaseDirectory.TrimEnd('\\'),
                settings = new
                {
                    s.Roots,
                    s.SortField,
                    s.SortDesc,
                    s.IconSize,
                    s.SidebarWidth,
                    s.ShowHidden,
                    s.Accent,
                    s.Theme,
                    s.Favorites,
                    s.Tags,
                },
                drives = state.Fs.Drives(),
                specials = Specials(),
                fileTags = s.FileTags,
                index = state.Index.Status,
                ai = new
                {
                    s.Ai.Enabled,
                    s.Ai.AllowContent,
                    s.Ai.ActiveProviderId,
                    providers = s.Ai.Providers.Select(p => new
                    {
                        p.Id,
                        p.Name,
                        p.BaseUrl,
                        p.Protocol,
                        p.Model,
                        p.SummaryModel,
                        p.Vision,
                        hasKey = state.Store.HasKey(p.Id),
                        mask = Store.Mask(state.Store.GetKey(p.Id)),
                    }),
                },
                hasWallpaper = state.Fs.Wallpaper() is not null,
            });
        });

        // ---------- 浏览 ----------
        app.MapGet("/api/list", (string? path, string? sort, bool? desc, bool? hidden) =>
            Results.Ok(state.Fs.List(path ?? @"D:\", sort ?? state.Store.Settings.SortField,
                desc ?? state.Store.Settings.SortDesc, hidden ?? state.Store.Settings.ShowHidden)));

        app.MapGet("/api/tree", (string? path) =>
            path is null ? Results.Ok(Array.Empty<FsEntry>()) : Results.Ok(state.Fs.ChildrenDirs(path)));

        app.MapGet("/api/search", (string? q, int? limit) =>
            Results.Ok(string.IsNullOrWhiteSpace(q)
                ? Array.Empty<FsEntry>()
                : state.Index.Search(q, Math.Clamp(limit ?? 200, 1, 2000))));

        app.MapGet("/api/recents", (int? limit) =>
            Results.Ok(state.Index.Recents(Math.Clamp(limit ?? 60, 1, 500))));

        app.MapGet("/api/preview", (string? path) =>
            path is null ? Results.BadRequest() : Results.Ok(state.Fs.Preview(path)));

        app.MapGet("/api/stat", async (string? path, CancellationToken ct) =>
        {
            var full = PathUtil.Norm(path);
            if (full is null)
            {
                return Results.BadRequest(new { ok = false, error = "路径无效" });
            }

            try
            {
                if (Directory.Exists(full))
                {
                    using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    cts.CancelAfter(TimeSpan.FromSeconds(10));
                    var (size, files, dirs) = await Task.Run(() => state.Fs.FolderSize(full, cts.Token), cts.Token);
                    return Results.Ok(new { ok = true, path = full, size, files, dirs, isDir = true });
                }

                if (File.Exists(full))
                {
                    var fi = new FileInfo(full);
                    return Results.Ok(new { ok = true, path = full, size = fi.Length, files = 1, dirs = 0, isDir = false });
                }
            }
            catch (OperationCanceledException)
            {
                return Results.Ok(new { ok = false, error = "目录太大，统计超时" });
            }

            return Results.Ok(new { ok = false, error = "不存在" });
        });

        // ---------- 缩略图 / 原始文件 ----------
        app.MapGet("/api/thumb", (string? path, int? size) =>
        {
            var full = PathUtil.Norm(path);
            if (full is null || (!File.Exists(full) && !Directory.Exists(full)))
            {
                return Results.NoContent();
            }

            try
            {
                var fi = new FileInfo(full);
                var bytes = state.Thumbs.Get(full, size ?? 96,
                    fi.Exists ? fi.LastWriteTimeUtc.Ticks : 0, fi.Exists ? fi.Length : 0);
                return bytes is null
                    ? Results.NoContent()
                    : Results.File(bytes, "image/png", enableRangeProcessing: true);
            }
            catch
            {
                return Results.NoContent();
            }
        });

        app.MapGet("/api/raw", (string? path) =>
        {
            var full = PathUtil.Norm(path);
            if (full is null || !File.Exists(full))
            {
                return Results.NotFound();
            }

            var types = new FileExtensionContentTypeProvider();
            if (!types.TryGetContentType(full, out var mime))
            {
                mime = "application/octet-stream";
            }

            return Results.File(full, mime, enableRangeProcessing: true);
        });

        app.MapGet("/api/wallpaper", () =>
        {
            var wp = state.Fs.Wallpaper();
            if (wp is null)
            {
                return Results.NoContent();
            }

            var types = new FileExtensionContentTypeProvider();
            if (!types.TryGetContentType(wp, out var mime))
            {
                mime = "image/jpeg";
            }

            return Results.File(wp, mime, enableRangeProcessing: true);
        });

        // ---------- 文件操作 ----------
        app.MapPost("/api/op", async (JsonElement body) =>
        {
            var op = Prop(body, "op");
            var paths = PropArray(body, "paths");
            var target = Prop(body, "target");
            var name = Prop(body, "name");
            var single = Prop(body, "path");

            try
            {
                OpResult result = op switch
                {
                    "mkdir" => FileOps.Mkdir(target ?? @"D:\", string.IsNullOrWhiteSpace(name) ? "新建文件夹" : name),
                    "newfile" => NewFile(target ?? @"D:\", string.IsNullOrWhiteSpace(name) ? "新建文档.txt" : name),
                    "rename" => FileOps.Rename(single ?? "", name ?? ""),
                    "copy" => FileOps.Copy(paths.Count > 0 ? paths : new List<string> { single ?? "" }, target ?? "", false),
                    "move" => FileOps.Copy(paths.Count > 0 ? paths : new List<string> { single ?? "" }, target ?? "", true),
                    "trash" => FileOps.Trash(paths.Count > 0 ? paths : new List<string> { single ?? "" }),
                    "delete" => FileOps.Delete(paths.Count > 0 ? paths : new List<string> { single ?? "" }),
                    "open" => FileOps.Open(single ?? ""),
                    "reveal" => FileOps.Reveal(single ?? ""),
                    "openwith" => FileOps.OpenWith(single ?? ""),
                    "properties" => FileOps.ShowProperties(single ?? ""),
                    "terminal" => FileOps.OpenTerminal(single ?? target ?? @"D:\"),
                    "duplicate" => Duplicate(paths.Count > 0 ? paths : new List<string> { single ?? "" }),
                    "zip" => await Task.Run(() => Zip(paths, target)),
                    "extract" => await Task.Run(() => Extract(single ?? "", target)),
                    _ => new OpResult(false, "未知操作：" + op),
                };

                return Results.Ok(result);
            }
            catch (Exception ex)
            {
                AppPaths.Log($"操作 {op} 失败：{ex}");
                return Results.Ok(new OpResult(false, ex.Message));
            }
        });

        // ---------- 设置 ----------
        app.MapPost("/api/settings", (JsonElement body) =>
        {
            var s = state.Store.Settings;
            try
            {
                if (body.TryGetProperty("roots", out var roots) && roots.ValueKind == JsonValueKind.Array)
                {
                    var list = roots.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x))
                        .Select(x => x!).ToList();
                    if (list.Count > 0)
                    {
                        s.Roots = list;
                    }
                }

                if (body.TryGetProperty("sortField", out var sf) && sf.ValueKind == JsonValueKind.String)
                {
                    s.SortField = sf.GetString() ?? "name";
                }

                if (body.TryGetProperty("sortDesc", out var sd) && sd.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    s.SortDesc = sd.GetBoolean();
                }

                if (body.TryGetProperty("iconSize", out var iz) && iz.ValueKind == JsonValueKind.Number)
                {
                    s.IconSize = Math.Clamp(iz.GetInt32(), 48, 168);
                }

                if (body.TryGetProperty("sidebarWidth", out var sw) && sw.ValueKind == JsonValueKind.Number)
                {
                    s.SidebarWidth = Math.Clamp(sw.GetDouble(), 160, 360);
                }

                if (body.TryGetProperty("showHidden", out var sh) && sh.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    s.ShowHidden = sh.GetBoolean();
                }

                if (body.TryGetProperty("accent", out var ac) && ac.ValueKind == JsonValueKind.String)
                {
                    s.Accent = ac.GetString() ?? "#0A84FF";
                }

                if (body.TryGetProperty("theme", out var th) && th.ValueKind == JsonValueKind.String)
                {
                    s.Theme = th.GetString() ?? "auto";
                }

                if (body.TryGetProperty("ai", out var ai) && ai.ValueKind == JsonValueKind.Object)
                {
                    if (ai.TryGetProperty("enabled", out var en) && en.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    {
                        s.Ai.Enabled = en.GetBoolean();
                    }

                    if (ai.TryGetProperty("allowContent", out var alc) &&
                        alc.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    {
                        s.Ai.AllowContent = alc.GetBoolean();
                    }

                    if (ai.TryGetProperty("activeProviderId", out var ap) && ap.ValueKind == JsonValueKind.String)
                    {
                        s.Ai.ActiveProviderId = ap.GetString();
                    }
                }

                state.Store.Save();
                return Results.Ok(new { ok = true });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { ok = false, error = ex.Message });
            }
        });

        app.MapPost("/api/fav", (JsonElement body) =>
        {
            var s = state.Store.Settings;
            var path = PathUtil.Norm(Prop(body, "path"));
            if (path is null)
            {
                return Results.BadRequest();
            }

            var existing = s.Favorites.FirstOrDefault(f => string.Equals(f.Path, path, StringComparison.OrdinalIgnoreCase));
            if (existing is not null)
            {
                s.Favorites.Remove(existing);
            }
            else
            {
                s.Favorites.Add(new Favorite { Path = path, Name = Path.GetFileName(path.TrimEnd('\\')) });
            }

            state.Store.Save();
            return Results.Ok(new { ok = true, favorites = s.Favorites });
        });

        app.MapPost("/api/tags", (JsonElement body) =>
        {
            var s = state.Store.Settings;
            var path = PathUtil.Norm(Prop(body, "path"));
            var tags = PropArray(body, "tags");
            if (path is null)
            {
                return Results.BadRequest();
            }

            if (tags.Count == 0)
            {
                s.FileTags.Remove(path);
            }
            else
            {
                s.FileTags[path] = tags;
            }

            state.Store.Save();
            return Results.Ok(new { ok = true });
        });

        app.MapPost("/api/tagdef", (JsonElement body) =>
        {
            var s = state.Store.Settings;
            var name = Prop(body, "name");
            var color = Prop(body, "color");
            if (string.IsNullOrWhiteSpace(name))
            {
                return Results.BadRequest();
            }

            var def = s.Tags.FirstOrDefault(t => t.Name == name);
            if (def is null)
            {
                s.Tags.Add(new TagDef
                {
                    Id = Guid.NewGuid().ToString("n")[..8],
                    Name = name,
                    Color = string.IsNullOrWhiteSpace(color) ? "#0A84FF" : color,
                });
                state.Store.Save();
            }

            return Results.Ok(new { ok = true, tags = s.Tags });
        });

        // ---------- 索引 ----------
        app.MapGet("/api/index/status", () => Results.Ok(state.Index.Status));

        app.MapPost("/api/index/rescan", () =>
        {
            state.Index.Rebuild();
            return Results.Ok(new { ok = true });
        });

        // ---------- AI ----------
        app.MapPost("/api/ai/provider", (JsonElement body) =>
        {
            var s = state.Store.Settings.Ai;
            var id = Prop(body, "id");
            var provider = s.Providers.FirstOrDefault(p => p.Id == id);
            if (provider is null)
            {
                provider = new AiProviderConfig { Id = string.IsNullOrWhiteSpace(id) ? Guid.NewGuid().ToString("n")[..8] : id };
                s.Providers.Add(provider);
            }

            provider.Name = Prop(body, "name") ?? provider.Name;
            provider.BaseUrl = Prop(body, "baseUrl") ?? provider.BaseUrl;
            provider.Protocol = Prop(body, "protocol") ?? "openai";
            provider.Model = Prop(body, "model") ?? provider.Model;
            provider.SummaryModel = Prop(body, "summaryModel");
            if (body.TryGetProperty("vision", out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                provider.Vision = v.GetBoolean();
            }

            var key = Prop(body, "key");
            if (!string.IsNullOrWhiteSpace(key))
            {
                state.Store.SetKey(provider.Id, key);
            }

            s.ActiveProviderId ??= provider.Id;
            if (string.IsNullOrEmpty(s.ActiveProviderId))
            {
                s.ActiveProviderId = provider.Id;
            }

            state.Store.Save();
            return Results.Ok(new { ok = true, id = provider.Id });
        });

        app.MapPost("/api/ai/provider/delete", (JsonElement body) =>
        {
            var s = state.Store.Settings.Ai;
            var id = Prop(body, "id");
            s.Providers.RemoveAll(p => p.Id == id);
            state.Store.SetKey(id ?? "", null);
            if (s.ActiveProviderId == id)
            {
                s.ActiveProviderId = s.Providers.FirstOrDefault()?.Id;
            }

            state.Store.Save();
            return Results.Ok(new { ok = true });
        });

        app.MapPost("/api/ai/test", async (JsonElement body, CancellationToken ct) =>
        {
            var s = state.Store.Settings.Ai;
            var id = Prop(body, "id");
            var provider = s.Providers.FirstOrDefault(p => p.Id == id) ?? state.Ai.Active();
            if (provider is null)
            {
                return Results.Ok(new { ok = false, error = "还没有供应商" });
            }

            var reply = await state.Ai.ChatAsync(provider, "你是一个连接测试助手，只回复四个字：连接正常", "测试", null, ct);
            return Results.Ok(new { ok = reply.Ok, text = reply.Text, error = reply.Error, model = reply.Model });
        });

        app.MapPost("/api/ai/run", async (JsonElement body, CancellationToken ct) =>
        {
            var feature = Prop(body, "feature") ?? "";
            var result = await AiFeatures.RunAsync(state.Ai, state.Store, feature, body, ct);
            return Results.Ok(result);
        });

        // ---------- 自检（开发用） ----------
        app.MapPost("/api/dev/js", async (JsonElement body) =>
        {
            var code = Prop(body, "code") ?? "";
            var result = await WindowActions.EvalAsync(code);
            return Results.Ok(new { ok = true, result });
        });

        app.MapGet("/api/dev/win", () =>
        {
            var w = WindowActions.Host;
            if (w is null)
            {
                return Results.Ok(new { ok = false });
            }

            return w.Dispatcher.Invoke(() =>
            {
                var rb = w.RestoreBounds;
                return Results.Ok(new
                {
                    ok = true,
                    state = w.WindowState.ToString(),
                    left = w.Left,
                    top = w.Top,
                    width = w.Width,
                    height = w.Height,
                    restore = new { left = rb.Left, top = rb.Top, width = rb.Width, height = rb.Height }
                });
            });
        });

        // ---------- 窗口 ----------
        app.MapPost("/api/window/{act}", (string act) =>
        {
            WindowActions.Run(w =>
            {
                switch (act)
                {
                    case "drag":
                        w.DoDrag();
                        break;
                    case "min":
                        w.WindowState = System.Windows.WindowState.Minimized;
                        break;
                    case "max":
                        w.ToggleMaximize();
                        break;
                    case "close":
                        w.Close();
                        break;
                }
            });
            return Results.Ok(new { ok = true });
        });

        // 边框改大小：WebView2 铺满客户区，系统拿不到边缘命中测试，只能由页面发起
        app.MapPost("/api/window/resize", (JsonElement body) =>
        {
            var edge = Prop(body, "edge") ?? "";
            WindowActions.Run(w => w.StartResize(edge));
            return Results.Ok(new { ok = true });
        });
    }

    private sealed record Special(string Name, string Path, string Icon);

    private static List<Special> Specials()
    {
        var list = new List<Special>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string name, string path, string icon)
        {
            if (!string.IsNullOrEmpty(path) && Directory.Exists(path) && seen.Add(path))
            {
                list.Add(new Special(name, path, icon));
            }
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        Add("桌面", Environment.GetFolderPath(Environment.SpecialFolder.Desktop), "desktop");
        Add("下载", Path.Combine(home, "Downloads"), "downloads");
        Add("文档", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "documents");
        Add("图片", Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "pictures");
        Add("音乐", Environment.GetFolderPath(Environment.SpecialFolder.MyMusic), "music");
        Add("视频", Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "videos");
        return list;
    }

    private static OpResult NewFile(string dir, string name)
    {
        try
        {
            var target = Path.Combine(dir, name);
            if (File.Exists(target))
            {
                var stem = Path.GetFileNameWithoutExtension(target);
                var ext = Path.GetExtension(target);
                for (var i = 2; i < 500; i++)
                {
                    var candidate = Path.Combine(dir, $"{stem} ({i}){ext}");
                    if (!File.Exists(candidate))
                    {
                        target = candidate;
                        break;
                    }
                }
            }

            File.WriteAllText(target, "");
            return new OpResult(true, Path: target, Count: 1);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    private static OpResult Duplicate(List<string> paths)
    {
        var count = 0;
        foreach (var p in paths)
        {
            try
            {
                if (File.Exists(p))
                {
                    var dir = Path.GetDirectoryName(p) ?? "";
                    var stem = Path.GetFileNameWithoutExtension(p);
                    var ext = Path.GetExtension(p);
                    var dest = Path.Combine(dir, $"{stem} 副本{ext}");
                    for (var i = 2; File.Exists(dest); i++)
                    {
                        dest = Path.Combine(dir, $"{stem} 副本 {i}{ext}");
                    }

                    File.Copy(p, dest);
                    count++;
                }
                else if (Directory.Exists(p))
                {
                    var parent = Path.GetDirectoryName(p.TrimEnd('\\')) ?? "";
                    var dest = Path.Combine(parent, Path.GetFileName(p) + " 副本");
                    for (var i = 2; Directory.Exists(dest); i++)
                    {
                        dest = Path.Combine(parent, $"{Path.GetFileName(p)} 副本 {i}");
                    }

                    FileOps.Copy(new[] { p }, parent, false);
                    count++;
                }
            }
            catch (Exception ex)
            {
                return new OpResult(false, ex.Message, Count: count);
            }
        }

        return new OpResult(true, Count: count);
    }

    private static OpResult Zip(List<string> paths, string? targetDir)
    {
        try
        {
            if (paths.Count == 0)
            {
                return new OpResult(false, "没有选中任何项目");
            }

            var first = paths[0];
            var dir = targetDir ?? Path.GetDirectoryName(first) ?? @"D:\";
            var baseName = paths.Count == 1
                ? Path.GetFileNameWithoutExtension(first.TrimEnd('\\'))
                : Path.GetFileName(dir.TrimEnd('\\'));
            var zipPath = Path.Combine(dir, baseName + ".zip");
            for (var i = 2; File.Exists(zipPath); i++)
            {
                zipPath = Path.Combine(dir, $"{baseName} ({i}).zip");
            }

            using (var zip = System.IO.Compression.ZipFile.Open(zipPath, System.IO.Compression.ZipArchiveMode.Create))
            {
                foreach (var p in paths)
                {
                    if (File.Exists(p))
                    {
                        zip.CreateEntryFromFile(p, Path.GetFileName(p), System.IO.Compression.CompressionLevel.Optimal);
                    }
                    else if (Directory.Exists(p))
                    {
                        var root = p.TrimEnd('\\');
                        foreach (var f in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                        {
                            var rel = Path.GetRelativePath(root, f);
                            zip.CreateEntryFromFile(f, Path.Combine(Path.GetFileName(root), rel),
                                System.IO.Compression.CompressionLevel.Optimal);
                        }
                    }
                }
            }

            return new OpResult(true, Path: zipPath, Count: 1);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    private static OpResult Extract(string path, string? targetDir)
    {
        try
        {
            if (!File.Exists(path))
            {
                return new OpResult(false, "文件不存在");
            }

            var dir = targetDir;
            if (string.IsNullOrWhiteSpace(dir))
            {
                dir = Path.Combine(Path.GetDirectoryName(path) ?? @"D:\",
                    Path.GetFileNameWithoutExtension(path));
            }

            for (var i = 2; Directory.Exists(dir); i++)
            {
                dir = Path.Combine(Path.GetDirectoryName(path) ?? @"D:\",
                    $"{Path.GetFileNameWithoutExtension(path)} ({i})");
            }

            System.IO.Compression.ZipFile.ExtractToDirectory(path, dir);
            return new OpResult(true, Path: dir, Count: 1);
        }
        catch (Exception ex)
        {
            return new OpResult(false, ex.Message);
        }
    }

    private static string? Prop(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.ToString(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => null,
        };
    }

    private static List<string> PropArray(JsonElement body, string name)
    {
        var list = new List<string>();
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.Array)
        {
            foreach (var x in v.EnumerateArray())
            {
                if (x.ValueKind == JsonValueKind.String)
                {
                    var s = x.GetString();
                    if (!string.IsNullOrWhiteSpace(s))
                    {
                        list.Add(s);
                    }
                }
            }
        }

        return list;
    }

    public async ValueTask DisposeAsync()
    {
        if (_app is not null)
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await _app.StopAsync(cts.Token);
            }
            catch
            {
                // 忽略关闭异常
            }

            await _app.DisposeAsync();
            _app = null;
        }
    }
}
