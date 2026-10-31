"""生成 WiX 许可页用的 RTF（中文转 \\uNNNN 转义，避免编码问题）。

用法：python tools/make-eula.py installer/EULA.rtf
"""

import sys
from pathlib import Path

TITLE = "Aurora 许可协议"
BODY = [
    "Aurora 是一个在 Windows 上运行的文件管理器，用于浏览、整理和搜索本地文件。",
    "",
    "1. 你的文件属于你。Aurora 不会上传、复制或修改任何未经你确认的文件；"
    "索引与设置保存在 %LOCALAPPDATA%\\Aurora 下，删除该目录即可完全清除运行痕迹。",
    "",
    "2. AI 功能需要你自行填写第三方模型的 API Key。只有在你在设置中启用、"
    "并主动点击对应功能时，Aurora 才会把文件名、元数据（以及你明确允许时的文件正文）"
    "发送到你配置的服务商。密钥使用 Windows DPAPI 加密保存，仅当前用户可以解密。",
    "",
    "3. 软件按“现状”提供，不附带任何明示或暗示的担保。删除、覆盖等操作会在执行前"
    "显示确认，但仍建议你对重要数据自行备份。",
    "",
    "4. 本程序使用的图标：Lucide（ISC 许可）、vscode-icons（MIT 许可）。",
    "",
    "点击“我接受”即表示你已阅读并同意以上条款。",
]


def rtf_escape(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if ch in "\\{}":
            out.append("\\" + ch)
        elif code < 128:
            out.append(ch)
        else:
            # RTF unicode escape: signed 16-bit
            signed = code if code < 32768 else code - 65536
            out.append(f"\\u{signed}?")
    return "".join(out)


def build(lines: list[str]) -> str:
    body = []
    for line in lines:
        body.append(
            r"{\pard\sa180\sl320\slmult1\f1\fs20 " + rtf_escape(line) + r"\par}"
        )
    head = (
        r"{\rtf1\ansi\ansicpg936\deff0"
        r"{\fonttbl{\f0\fnil\fcharset134 Microsoft YaHei;}{\f1\fnil\fcharset134 Microsoft YaHei;}}"
        r"{\colortbl;\red58\green58\blue64;\red120\green120\blue130;}"
    )
    title = r"{\pard\sa240\f0\fs32\b\cf1 " + rtf_escape(TITLE) + r"\par}"
    return head + title + "".join(body) + "}"


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "installer/EULA.rtf")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(BODY), encoding="ascii")
    print(f"wrote {out} ({out.stat().st_size} bytes)")
