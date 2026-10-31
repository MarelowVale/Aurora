# Aurora · D 盘工作台

一个独立窗口的 macOS 风格文件管理器，专为「管好整个盘」设计（任意盘符/目录都能挂）：双栏浏览、毫秒级全盘搜索、快速预览、标签页、标签与收藏，外加一层**可自己配置 API Key** 的 AI 能力。

不是浏览器标签页，也不是资源管理器的皮 —— 它是一个自绘 UI 的原生 Windows 程序（.NET 10 WPF + WebView2），关掉资源管理器也能照常用。

---

## 安装

两个产物都在仓库根的 `dist\`（或从 [Releases](https://github.com/MarelowVale/Aurora/releases) 下载）：

| 文件 | 用途 |
| --- | --- |
| `Aurora-1.0.0-x64.msi` | 安装包（推荐）。双击即可，**无需管理员权限**，默认装到 `%LOCALAPPDATA%\Programs\Aurora`；会建开始菜单和桌面快捷方式，可在「设置 → 应用」里卸载 |
| `Aurora-1.0.0-portable-x64.zip` | 便携版。解压到任意目录，双击 `Aurora.exe` 即用，不写注册表、不建快捷方式 |

两个包都是**自包含**的（内置 .NET 10 运行时），目标机器只需有 WebView2 运行时（Windows 11 自带，Windows 10 多半也已随 Edge 安装）。

> 校验：`SHA256SUMS.txt` 里是上面两个文件的 SHA-256。
> 卸载：`msiexec /x Aurora-1.0.0-x64.msi`，或在「设置 → 应用 → 已安装的应用 → Aurora 文件管理器」里点卸载。卸载只删程序，不动 `%LOCALAPPDATA%\Aurora` 里的设置与索引。

---

## 从源码运行

```
run.cmd
```

在仓库根目录双击 `run.cmd` 即可。第一次会自动 `dotnet build -c Release`，之后直接启动。也可以直接运行 `bin\Release\net10.0-windows\Aurora.exe`。

要求：Windows 10/11（自带 WebView2 Runtime）、.NET 10 SDK（仅首次编译需要）。

---

## 为什么不是"复刻 macOS 系统"

macOS 27（Golden Gate，2026 秋）的兼容列表里**只有 Apple Silicon 机型**，Intel Mac 已被彻底放弃。x86 PC 上不存在任何合法的安装或模拟途径。所以这里的做法是：**借它的设计语言（毛玻璃、交通灯、圆角、克制的强调色），做 Windows 上真正好用的文件管理**。

---

## 功能

**浏览**

- 网格 / 列表双视图，`Ctrl+1` / `Ctrl+2` 切换，图标大小可调
- 面包屑导航（点任意一级跳转，`Ctrl+L` 直接输入路径）
- 多标签页：`Ctrl+T` 新建、`Ctrl+W` 关闭、`Ctrl+Tab` 切换，每个标签独立历史
- 前进 / 后退 / 上一级，Alt+方向键、Backspace
- 侧栏：常用位置、磁盘、收藏、最近使用；底部磁盘容量条
- 过滤器：全部 / 文件夹 / 图片 / 文档 / 代码…，附数量
- 显示隐藏文件开关
- 信息面板：类型、大小、时间、位置、标签、六个快捷动作

**找东西**

- 全盘索引 + 即时搜索（本地数据库，百万级条目亚秒返回），命中片段高亮
- 搜索结果直接显示父目录，不用猜文件在哪
- 标签分类 + 收藏夹 + 最近使用
- 空格快速预览：文本、代码、图片、PDF 缩略，`Esc` 关闭
- `Ctrl+K` 命令面板：输入即命令，也可直接跳路径

**动手**

- 新建文件夹 / 文本文件、重命名（F2 就地编辑）、复制副本
- 复制 / 剪切 / 粘贴（跨盘自动降级为"复制 + 删除"）、拖放移动
- 压缩为 ZIP、解压到此处
- 移到回收站（Del，可还原）、永久删除（Shift+Del，二次确认）
- 在资源管理器中显示、打开方式、显示属性、在此处打开终端
- 批量操作（多选后右键）

**AI（自己配 Key）**

| 功能 | 说明 |
| --- | --- |
| 自然语言搜索 | 一句话拆成关键词 + 类型/时间条件，再走本地索引，不建向量库、断网可用 |
| 询问 / 总结 | 对选中文件提问或出摘要（docx、txt、md、csv、json、代码） |
| 智能重命名 | 说规则 → 出预览表（旧名 / 新名 / 理由）→ 确认后才改 |
| 智能整理 | 分析当前文件夹 → 出分组方案 → 确认后建目录并移动 |
| 自然语言命令 | 一句话生成操作计划（mkdir/move/rename/copy/trash）→ 预览 → 执行，删除单独二次确认 |

安全边界：

- **AI 永远不会自己动文件**，所有写操作都要你在预览上点确认
- 默认只发送文件名与元数据；勾选「允许发送文件内容」才会发送正文
- API Key 用 Windows DPAPI 加密存本机（`secrets.bin`），明文不落盘、不回传页面，界面只显示掩码
- 关掉「启用 AI」后所有 AI 入口自动隐藏，不发任何请求

---

## 配置 AI

设置（`Ctrl+,`）→「AI 与模型」：

1. 点一个预设（DeepSeek / OpenAI / Anthropic / Gemini / OpenRouter / 硅基流动 / 通义千问 / Ollama 本地），或手填
2. 填 Base URL、模型名、API Key（本地 Ollama 可不填）
3. **协议**：绝大多数用「OpenAI 兼容」；Anthropic 官方接口选「Anthropic」
4. 点「测试连接」确认打通，再「保存供应商」

也可以为「摘要 / 重命名」单独指定更便宜的模型。支持多家供应商并存，随时切换启用哪一家。

---

## 快捷键

| 键 | 动作 |
| --- | --- |
| `Ctrl+K` | 命令面板 |
| `Ctrl+F` | 搜索框 |
| `Ctrl+L` | 输入路径 |
| `Ctrl+T` / `Ctrl+W` / `Ctrl+Tab` | 新建 / 关闭 / 切换标签页 |
| `Ctrl+J` | AI 助手 |
| `Ctrl+,` | 设置 |
| `Ctrl+Shift+N` | 新建文件夹 |
| `F2` | 重命名 |
| `Del` / `Shift+Del` | 回收站 / 永久删除 |
| `Space` | 快速预览 |
| `Enter` | 打开 |
| `Ctrl+A` / `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | 全选 / 复制 / 剪切 / 粘贴 |
| `Ctrl+1` / `Ctrl+2` | 网格 / 列表 |
| `Alt+←` / `Alt+→` / `Alt+↑` | 后退 / 前进 / 上一级 |
| `F5` | 刷新 |

---

## 数据与隐私

| 路径 | 内容 |
| --- | --- |
| `%LOCALAPPDATA%\Aurora\settings.json` | 设置、收藏、标签 |
| `%LOCALAPPDATA%\Aurora\index.db` | 文件索引（可随时删除，会重建） |
| `%LOCALAPPDATA%\Aurora\secrets.bin` | DPAPI 加密的 API Key |
| `%LOCALAPPDATA%\Aurora\thumbs\` | 缩略图缓存（30 天过期） |

- **文件系统是唯一真相**：索引只是加速搜索的缓存，删了不影响任何文件。
- 不安装服务、不注入其它进程、不接管系统外壳；所有能力都在自己的窗口里。删掉程序目录不会影响 D 盘上的任何文件。

---

## 技术栈

- **.NET 10 WPF** 宿主，WebView2 渲染界面，Kestrel 在 `127.0.0.1` 随机端口提供带 token 的本地 API
- 前端**原生 HTML/CSS/JS**（无框架、无构建步骤），图标为内联 SVG
- **Microsoft.Data.Sqlite** 索引；缩略图通过 `IShellItemImageFactory` 取真实系统缩略图
- 视觉：DWM 圆角 + 暗色边框，壁纸高斯模糊做底，毛玻璃分层

### 图标

| 用途 | 来源 | 许可 |
|---|---|---|
| 界面细线图标 | [Lucide](https://lucide.dev) | ISC |
| 文件类型彩色图标 | [vscode-icons](https://github.com/vscode-icons/vscode-icons) | MIT |
| 文件夹 / 磁盘 / 星标 / 常用位置 | 自绘渐变 | 随本项目 |

图标在构建期由 `tools/gen-icons.mjs` 从本地 npm 包抽取、合并成一个 `web/icons.js` 内联分发，**运行期不联网**。

```
Aurora/
├─ App.xaml(.cs)        启动、装配
├─ MainWindow.xaml(.cs) 窗口外壳、DWM、WebView2
├─ Core/                文件系统与数据：FsService / FileOps / Indexer / Thumbs / Store / AiService / AiFeatures
├─ Server/              ApiServer / AppState
├─ web/                 index.html · app.css · app.js · icons.js · app-icon.png
├─ installer/            Aurora.wxs · EULA.rtf · banner.bmp · dialog.bmp
├─ dist/                 发布产物（不进 git，走 Release）
└─ tools/                开发辅助：图标生成、截图、图标检查、本地假模型
```

> 注意：`Server\` 与 `web\` 必须分开。Windows 上 `Web` 与 `web` 是同一个目录，早先把 `ApiServer.cs` 放在 `Web\` 里会被当成静态资源，导致源码可通过 HTTP 下载。

### 打包

```
# 0) 首次需要安装 WiX 6 命令行工具
dotnet tool install --global wix --version 6.0.2

# 1) 自包含发布
dotnet publish -c Release -r win-x64 --self-contained true -o build\publish

# 2) 生成 MSI（必须在 installer 目录下执行，相对路径按 cwd 解析）
cd installer
wix build Aurora.wxs -arch x64 ^
  -bindpath "publish=..\build\publish" ^
  -ext WixToolset.UI.wixext -culture zh-CN ^
  -o ..\build\Aurora-1.0.0-x64.msi
```

版本号只有一个来源：`Aurora.csproj` 里的 `<Version>`。它在编译期写入程序集，运行期既用于 `Aurora.exe` 的"文件属性"，也由 `/api/bootstrap` 提供给"设置 → 关于"显示。改版本时同步改 `installer\Aurora.wxs` 的 `Package Version`（MSI 的升级判定依赖它）。

---

## 已知边界

- 拖放目前仅支持程序内拖到文件夹上移动；从资源管理器拖入尚未实现
- 复制/剪切使用程序内剪贴板，不写系统剪贴板，因此在资源管理器里无法直接 `Ctrl+V`
- 删除走的是 Windows 回收站，还原请仍在资源管理器里做（这里只负责"送进去"）
- 索引聚焦 D 盘；新增其它盘需在设置里加根目录后重建（注：这是开发期默认配置，实际任意盘符都可在设置里添加）
- 全文内容检索（非文件名）尚未做，只在 AI 询问时按需读取正文

---

## License

[MIT](./LICENSE)。图标素材遵循其各自许可：Lucide（ISC）、vscode-icons（MIT）。
