using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Aurora;

public sealed class Favorite
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
}

public sealed class TagDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#0A84FF";
}

public sealed class AiProviderConfig
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string BaseUrl { get; set; } = "";
    /// <summary>openai = /chat/completions 兼容；anthropic = /v1/messages。</summary>
    public string Protocol { get; set; } = "openai";
    public string Model { get; set; } = "";
    public string? SummaryModel { get; set; }
    public bool Vision { get; set; }
}

public sealed class AiSettings
{
    public bool Enabled { get; set; } = true;
    /// <summary>是否允许把文件正文发给模型；默认关闭。</summary>
    public bool AllowContent { get; set; }
    public string? ActiveProviderId { get; set; }
    public List<AiProviderConfig> Providers { get; set; } = new();
}

public sealed class Settings
{
    public List<string> Roots { get; set; } = new() { @"D:\" };
    public bool ShowHidden { get; set; }
    public string Theme { get; set; } = "auto";
    public string Accent { get; set; } = "#0A84FF";
    public string SortField { get; set; } = "name";
    public bool SortDesc { get; set; }
    public int IconSize { get; set; } = 78;
    public double SidebarWidth { get; set; } = 216;
    public List<Favorite> Favorites { get; set; } = new();
    public List<TagDef> Tags { get; set; } = new();
    public Dictionary<string, List<string>> FileTags { get; set; } = new();
    public AiSettings Ai { get; set; } = new();
}

/// <summary>设置 + 密钥。密钥用 DPAPI 加密，明文永不落盘。</summary>
public sealed class Store
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly object _gate = new();
    private Dictionary<string, string> _keys = new(StringComparer.OrdinalIgnoreCase);

    public Settings Settings { get; private set; }

    public Store()
    {
        AppPaths.Ensure();
        Settings = LoadSettings();
        _keys = LoadSecrets();
    }

    private static Settings LoadSettings()
    {
        try
        {
            if (File.Exists(AppPaths.SettingsPath))
            {
                var text = File.ReadAllText(AppPaths.SettingsPath);
                var s = JsonSerializer.Deserialize<Settings>(text, Json);
                if (s is not null)
                {
                    return s;
                }
            }
        }
        catch (Exception ex)
        {
            AppPaths.Log("读取设置失败：" + ex.Message);
        }

        return new Settings();
    }

    public void Save()
    {
        lock (_gate)
        {
            try
            {
                var tmp = AppPaths.SettingsPath + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(Settings, Json));
                File.Move(tmp, AppPaths.SettingsPath, overwrite: true);
            }
            catch (Exception ex)
            {
                AppPaths.Log("保存设置失败：" + ex.Message);
            }
        }
    }

    private Dictionary<string, string> LoadSecrets()
    {
        try
        {
            if (File.Exists(AppPaths.SecretsPath))
            {
                var raw = Dpapi.Unprotect(File.ReadAllBytes(AppPaths.SecretsPath));
                var map = JsonSerializer.Deserialize<Dictionary<string, string>>(raw);
                if (map is not null)
                {
                    return new Dictionary<string, string>(map, StringComparer.OrdinalIgnoreCase);
                }
            }
        }
        catch (Exception ex)
        {
            AppPaths.Log("读取密钥失败（可能需要重新填写）：" + ex.Message);
        }

        return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    private void SaveSecrets()
    {
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(_keys);
            File.WriteAllBytes(AppPaths.SecretsPath, Dpapi.Protect(bytes));
        }
        catch (Exception ex)
        {
            AppPaths.Log("保存密钥失败：" + ex.Message);
        }
    }

    public void SetKey(string providerId, string? key)
    {
        lock (_gate)
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                _keys.Remove(providerId);
            }
            else
            {
                _keys[providerId] = key.Trim();
            }

            SaveSecrets();
        }
    }

    public string? GetKey(string providerId)
    {
        lock (_gate)
        {
            return _keys.TryGetValue(providerId, out var k) ? k : null;
        }
    }

    public bool HasKey(string providerId) => !string.IsNullOrEmpty(GetKey(providerId));

    /// <summary>给前端看的掩码，永远不返回明文。</summary>
    public static string Mask(string? key) =>
        string.IsNullOrEmpty(key) ? "" : key.Length <= 8 ? "••••••••" : key[..4] + "••••" + key[^4..];
}
