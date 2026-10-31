namespace Aurora;

/// <summary>把所有服务聚合在一起，API 层只依赖这个。</summary>
public sealed class AppState
{
    public Store Store { get; }
    public FsService Fs { get; }
    public Indexer Index { get; }
    public Thumbs Thumbs { get; }
    public AiService Ai { get; }

    private AppState(Store store, FsService fs, Indexer index, Thumbs thumbs, AiService ai)
    {
        Store = store;
        Fs = fs;
        Index = index;
        Thumbs = thumbs;
        Ai = ai;
    }

    public static Task<AppState> CreateAsync()
    {
        AppPaths.Ensure();
        var store = new Store();
        var state = new AppState(store, new FsService(), new Indexer(store), new Thumbs(), new AiService(store));

        // 索引过期就在后台重建，绝不阻塞窗口出现
        if (state.Index.Status.Stale)
        {
            try
            {
                state.Index.Rebuild();
            }
            catch (Exception ex)
            {
                AppPaths.Log("启动索引失败：" + ex.Message);
            }
        }

        return Task.FromResult(state);
    }
}
