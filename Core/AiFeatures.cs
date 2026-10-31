using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aurora;

/// <summary>
/// 把"功能"翻译成提示词。所有 AI 能力都经过这里，保证：
/// 只读不写、默认只发文件名、结果一定是可预览的结构化 JSON。
/// </summary>
public static class AiFeatures
{
    public static async Task<object> RunAsync(AiService ai, Store store, string feature, JsonElement args,
        CancellationToken ct)
    {
        var provider = ai.Active();
        if (provider is null)
        {
            return new { ok = false, error = "还没有配置 AI 供应商" };
        }

        string system, user;
        string? model = null;

        switch (feature)
        {
            case "test":
                system = "你是一个连接测试助手，只回复四个字：连接正常";
                user = "测试";
                break;

            case "search":
            {
                var q = Str(args, "q");
                var roots = string.Join("、", store.Settings.Roots);
                system = """
                    你是文件搜索助手。把用户的自然语言需求转成搜索条件。
                    只输出 JSON，不要任何解释。格式：
                    {"keywords":["关键词1","关键词2"],"exts":[".pdf"],"afterDays":0,"note":"一句中文说明"}
                    要求：keywords 给 3-6 个，包含同义词、英文写法、可能的缩写；exts 只填用户明确暗示的文件类型，否则空数组；afterDays 表示只要最近 N 天内的文件，0 表示不限。
                    """;
                user = $"用户需求：{q}\n可搜索的根目录：{roots}";
                break;
            }

            case "rename":
            {
                var items = args.TryGetProperty("items", out var arr) ? arr : default;
                var rule = Str(args, "rule");
                var sb = new StringBuilder();
                if (items.ValueKind == JsonValueKind.Array)
                {
                    foreach (var it in items.EnumerateArray())
                    {
                        if (sb.Length > 6000) break;
                        sb.Append("- ").Append(Str(it, "p")).Append('\n');
                    }
                }

                system = """
                    你是文件重命名助手。根据用户给的重命名规则，为每个文件给出新文件名。
                    只输出 JSON 数组，不要解释。格式：
                    [{"p":"原完整路径","n":"新文件名（不含目录）","why":"一句理由"}]
                    硬性要求：必须保留原始扩展名；不能包含 \ / : * ? " < > | 这些字符；不能与列表中的其他名字重复；
                    如果某个文件不需要改名，就不要包含它。
                    """;
                user = $"重命名规则：{rule}\n待处理文件：\n{sb}";
                model = provider.SummaryModel;
                break;
            }

            case "ask":
            {
                var question = Str(args, "question");
                var paths = args.TryGetProperty("paths", out var pa) && pa.ValueKind == JsonValueKind.Array
                    ? pa.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                    : new List<string>();

                var sb = new StringBuilder();
                foreach (var p in paths.Take(12))
                {
                    sb.Append("\n### ").Append(p).Append('\n');
                    if (store.Settings.Ai.AllowContent)
                    {
                        var content = AiService.ReadContent(p, 6000);
                        sb.Append(content is null ? "(无法读取正文，只有文件名)" : content).Append('\n');
                    }
                    else
                    {
                        sb.Append("(用户未允许发送正文，只提供文件名与目录信息)\n");
                    }
                }

                system = """
                    你是一个文件助手，帮用户理解他们选中的文件。
                    回答要具体、简短、有信息量；用户没问的不要展开。
                    如果只拿到文件名，就在回答里说明"仅根据文件名推断"。
                    """;
                user = $"问题：{question}\n文件：{sb}";
                model = provider.SummaryModel;
                break;
            }

            case "plan":
            {
                var cmd = Str(args, "cmd");
                var cwd = Str(args, "cwd");
                var listing = Str(args, "listing");
                system = """
                    你是文件管理命令解析器。把用户的中文/英文自然语言指令翻译成文件操作计划。
                    只输出 JSON，不要解释。格式：
                    {"reply":"一句中文说明你要做什么","ops":[{"op":"move","from":"完整路径","to":"完整目标路径","why":"理由"}]}
                    允许的 op：move（移动/整理）、rename（改名，to 是新完整路径）、mkdir（新建目录，to 是新目录完整路径）、copy（复制）、trash（删除到回收站，from 必填，to 留空）。
                    硬性要求：只能使用下面"当前目录内容"里真实存在的路径，不要编造；不确定就少给几条并在 reply 里说明；
                    删除操作要在 reply 里明确提示用户确认。
                    """;
                user = $"当前目录：{cwd}\n用户指令：{cmd}\n当前目录内容（可能被截断）：\n{listing}";
                break;
            }

            case "organize":
            {
                var dir = Str(args, "dir");
                var listing = Str(args, "listing");
                system = """
                    你是文件整理助手。为给定目录设计一套分类方案。
                    只输出 JSON，不要解释。格式：
                    {"reply":"一句总述","groups":[{"folder":"子目录名","reason":"理由","files":["完整路径1","完整路径2"]}]}
                    要求：子目录名用中文、简短、可读；每个文件只能出现在一个组里；最多 8 个组；
                    不要移动明显的系统文件或程序文件；无法归类的放进"其他"。
                    """;
                user = $"目录：{dir}\n内容：\n{listing}";
                break;
            }

            default:
                return new { ok = false, error = "未知的 AI 功能：" + feature };
        }

        var reply = await ai.ChatAsync(provider, system, user, model, ct);
        if (!reply.Ok)
        {
            return new { ok = false, error = reply.Error, model = reply.Model };
        }

        JsonNode? json = null;
        if (feature is "search" or "rename" or "plan" or "organize")
        {
            json = AiService.ParseJson(reply.Text);
        }

        return new
        {
            ok = true,
            text = reply.Text,
            json,
            model = reply.Model,
            promptTokens = reply.PromptTokens,
            completionTokens = reply.CompletionTokens,
        };
    }

    private static string Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? ""
            : "";
}
