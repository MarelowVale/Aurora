using System.Text.Json.Serialization;

namespace Aurora;

/// <summary>前端用的文件条目。字段名压到 1 个字母，减少 IPC 体积。</summary>
public sealed class FsEntry
{
    [JsonPropertyName("p")] public string Path { get; set; } = "";
    [JsonPropertyName("n")] public string Name { get; set; } = "";
    [JsonPropertyName("d")] public bool IsDir { get; set; }
    [JsonPropertyName("s")] public long Size { get; set; }
    [JsonPropertyName("m")] public long MTime { get; set; }
    [JsonPropertyName("c")] public long CTime { get; set; }
    [JsonPropertyName("e")] public string Ext { get; set; } = "";
    [JsonPropertyName("k")] public string Kind { get; set; } = "file";
    [JsonPropertyName("h")] public bool Hidden { get; set; }
    [JsonPropertyName("r")] public bool ReadOnly { get; set; }
    [JsonPropertyName("l")] public bool Link { get; set; }
    [JsonPropertyName("i")] public int Items { get; set; }
}

public static class Kinds
{
    private static readonly Dictionary<string, string> Map = new(StringComparer.OrdinalIgnoreCase)
    {
        [".png"] = "image", [".jpg"] = "image", [".jpeg"] = "image", [".gif"] = "image",
        [".bmp"] = "image", [".webp"] = "image", [".svg"] = "image", [".ico"] = "image",
        [".heic"] = "image", [".tif"] = "image", [".tiff"] = "image", [".avif"] = "image",
        [".psd"] = "image", [".ai"] = "image", [".raw"] = "image", [".cr2"] = "image", [".nef"] = "image",

        [".mp4"] = "video", [".mkv"] = "video", [".mov"] = "video", [".avi"] = "video",
        [".wmv"] = "video", [".flv"] = "video", [".webm"] = "video", [".m4v"] = "video", [".ts"] = "video",

        [".mp3"] = "audio", [".wav"] = "audio", [".flac"] = "audio", [".aac"] = "audio",
        [".ogg"] = "audio", [".m4a"] = "audio", [".wma"] = "audio", [".aiff"] = "audio",

        [".pdf"] = "pdf",
        [".doc"] = "doc", [".docx"] = "doc", [".rtf"] = "doc", [".odt"] = "doc",
        [".xls"] = "sheet", [".xlsx"] = "sheet", [".csv"] = "sheet", [".ods"] = "sheet",
        [".ppt"] = "slide", [".pptx"] = "slide", [".odp"] = "slide",
        [".txt"] = "text", [".md"] = "text", [".log"] = "text", [".ini"] = "text", [".cfg"] = "text",

        [".zip"] = "archive", [".rar"] = "archive", [".7z"] = "archive", [".tar"] = "archive",
        [".gz"] = "archive", [".bz2"] = "archive", [".xz"] = "archive", [".iso"] = "archive",

        [".exe"] = "app", [".msi"] = "app", [".bat"] = "app", [".cmd"] = "app", [".ps1"] = "app",
        [".lnk"] = "app", [".appx"] = "app", [".msix"] = "app",

        [".cs"] = "code", [".js"] = "code", [".ts"] = "code", [".py"] = "code", [".java"] = "code",
        [".c"] = "code", [".cpp"] = "code", [".h"] = "code", [".go"] = "code", [".rs"] = "code",
        [".json"] = "code", [".xml"] = "code", [".yml"] = "code", [".yaml"] = "code",
        [".html"] = "code", [".css"] = "code", [".sql"] = "code", [".sh"] = "code",

        [".ttf"] = "font", [".otf"] = "font", [".woff"] = "font", [".woff2"] = "font",
    };

    public static string Of(string ext) =>
        string.IsNullOrEmpty(ext) ? "file" : Map.TryGetValue(ext, out var k) ? k : "file";

    public static bool IsImage(string ext) => Of(ext) is "image";

    public static bool IsText(string ext) => Of(ext) is "text" or "code" or "sheet";

    public static bool CanThumbnail(string ext) => Of(ext) is "image" or "video" or "pdf";
}
