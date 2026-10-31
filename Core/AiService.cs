using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Aurora;

public sealed class AiReply
{
    public bool Ok { get; set; }
    public string? Text { get; set; }
    public JsonNode? Json { get; set; }
    public string? Error { get; set; }
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public string? Model { get; set; }
}

/// <summary>
/// 供应商适配层：只认两种协议（OpenAI 兼容 / Anthropic），其余厂商靠兼容端点接入。
/// 这一层永远不碰文件系统，只做"文本进、文本出"。
/// </summary>
public sealed class AiService
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(180) };
    private readonly Store _store;

    public AiService(Store store) => _store = store;

    public bool Configured => _store.Settings.Ai.Providers.Count > 0;

    public AiProviderConfig? Active()
    {
        var ai = _store.Settings.Ai;
        if (ai.Providers.Count == 0)
        {
            return null;
        }

        return ai.Providers.FirstOrDefault(p => p.Id == ai.ActiveProviderId) ?? ai.Providers[0];
    }

    private static string Endpoint(AiProviderConfig p)
    {
        var root = (p.BaseUrl ?? "").Trim().TrimEnd('/');
        if (root.Length == 0)
        {
            root = p.Protocol == "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com";
        }

        if (p.Protocol == "anthropic")
        {
            return root.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)
                ? root + "/messages"
                : root + "/v1/messages";
        }

        return root.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)
            ? root + "/chat/completions"
            : root + "/v1/chat/completions";
    }

    public async Task<AiReply> ChatAsync(AiProviderConfig provider, string system, string user,
        string? modelOverride, CancellationToken ct)
    {
        var key = _store.GetKey(provider.Id);
        if (string.IsNullOrEmpty(key) && !provider.BaseUrl.Contains("localhost") && !provider.BaseUrl.Contains("127.0.0.1"))
        {
            return new AiReply { Ok = false, Error = "该供应商还没有填写 API Key" };
        }

        var model = string.IsNullOrWhiteSpace(modelOverride) ? provider.Model : modelOverride;
        if (string.IsNullOrWhiteSpace(model))
        {
            return new AiReply { Ok = false, Error = "还没有指定模型名" };
        }

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, Endpoint(provider));
            JsonObject body;
            if (provider.Protocol == "anthropic")
            {
                req.Headers.Add("x-api-key", key);
                req.Headers.Add("anthropic-version", "2023-06-01");
                body = new JsonObject
                {
                    ["model"] = model,
                    ["max_tokens"] = 2048,
                    ["system"] = system,
                    ["messages"] = new JsonArray
                    {
                        new JsonObject { ["role"] = "user", ["content"] = user },
                    },
                };
            }
            else
            {
                req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", key ?? "none");
                body = new JsonObject
                {
                    ["model"] = model,
                    ["temperature"] = 0.2,
                    ["messages"] = new JsonArray
                    {
                        new JsonObject { ["role"] = "system", ["content"] = system },
                        new JsonObject { ["role"] = "user", ["content"] = user },
                    },
                };
            }

            req.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            using var res = await Http.SendAsync(req, ct);
            var payload = await res.Content.ReadAsStringAsync(ct);

            if (!res.IsSuccessStatusCode)
            {
                return new AiReply { Ok = false, Error = $"HTTP {(int)res.StatusCode}：{Trim(payload, 400)}", Model = model };
            }

            using var doc = JsonDocument.Parse(payload);
            var rootEl = doc.RootElement;
            var reply = new AiReply { Ok = true, Model = model };

            if (provider.Protocol == "anthropic")
            {
                if (rootEl.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array &&
                    content.GetArrayLength() > 0)
                {
                    reply.Text = content[0].TryGetProperty("text", out var t) ? t.GetString() : null;
                }
            }
            else
            {
                if (rootEl.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array &&
                    choices.GetArrayLength() > 0)
                {
                    var msg = choices[0].GetProperty("message");
                    reply.Text = msg.TryGetProperty("content", out var c) ? c.GetString() : null;
                }
            }

            if (rootEl.TryGetProperty("usage", out var usage))
            {
                reply.PromptTokens = usage.TryGetProperty("prompt_tokens", out var pt) ? pt.GetInt32() : 0;
                if (reply.PromptTokens == 0 && usage.TryGetProperty("input_tokens", out var it))
                {
                    reply.PromptTokens = it.GetInt32();
                }

                reply.CompletionTokens = usage.TryGetProperty("completion_tokens", out var ck) ? ck.GetInt32() : 0;
                if (reply.CompletionTokens == 0 && usage.TryGetProperty("output_tokens", out var ot))
                {
                    reply.CompletionTokens = ot.GetInt32();
                }
            }

            if (string.IsNullOrWhiteSpace(reply.Text))
            {
                reply.Ok = false;
                reply.Error = "模型没有返回内容";
            }

            return reply;
        }
        catch (OperationCanceledException)
        {
            return new AiReply { Ok = false, Error = "请求已取消" };
        }
        catch (Exception ex)
        {
            return new AiReply { Ok = false, Error = ex.Message };
        }
    }

    private static string Trim(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    /// <summary>从回复里抠出 JSON（模型经常带 ```json 包裹）。</summary>
    public static JsonNode? ParseJson(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var cleaned = Regex.Replace(text, "```(?:json)?", "").Trim();
        var start = cleaned.IndexOfAny(new[] { '{', '[' });
        var end = cleaned.LastIndexOfAny(new[] { '}', ']' });
        if (start < 0 || end <= start)
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(cleaned[start..(end + 1)]);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>抽取文件正文（只处理纯文本与 docx，够用且不引入重依赖）。</summary>
    public static string? ReadContent(string path, int maxChars = 6000)
    {
        try
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext is ".docx")
            {
                using var zip = ZipFile.OpenRead(path);
                var entry = zip.GetEntry("word/document.xml");
                if (entry is null)
                {
                    return null;
                }

                using var reader = new StreamReader(entry.Open());
                var xml = reader.ReadToEnd();
                var text = Regex.Replace(xml, "<w:p[ >]", "\n<w:p ");
                text = Regex.Replace(text, "<[^>]+>", "");
                text = System.Net.WebUtility.HtmlDecode(text);
                return text.Length > maxChars ? text[..maxChars] : text;
            }

            if (ext is ".txt" or ".md" or ".csv" or ".json" or ".xml" or ".yml" or ".yaml"
                or ".ini" or ".log" or ".cs" or ".js" or ".ts" or ".py" or ".java" or ".c" or ".cpp"
                or ".h" or ".go" or ".rs" or ".sql" or ".html" or ".css" or ".sh" or ".bat" or ".ps1")
            {
                var text = File.ReadAllText(path);
                return text.Length > maxChars ? text[..maxChars] : text;
            }
        }
        catch (Exception ex)
        {
            AppPaths.Log("读取正文失败 " + path + "：" + ex.Message);
        }

        return null;
    }
}
