# Aurora · Drive Workbench

English | [简体中文](./README.md)

A standalone-window, macOS-style file manager built to take charge of an entire drive (any drive or folder can be mounted): dual-pane browsing, millisecond full-drive search, quick look preview, tabs, tags and favorites, plus a layer of **self-configured API Key** AI.

It's not a browser tab, and it's not a skin over Explorer — it's a native Windows app with a self-drawn UI (.NET 10 WPF + WebView2). It works even when Explorer is closed.

---

## Install

Two artifacts live in `dist\` (or grab them from [Releases](https://github.com/MarelowVale/Aurora/releases)):

| File | Purpose |
| --- | --- |
| `Aurora-1.0.0-x64.msi` | Installer (recommended). Double-click, **no admin required**, installs to `%LOCALAPPDATA%\Programs\Aurora`; creates Start Menu and Desktop shortcuts, uninstallable from Settings → Apps |
| `Aurora-1.0.0-portable-x64.zip` | Portable. Unzip anywhere, run `Aurora.exe`, no registry writes, no shortcuts |

Both packages are **self-contained** (bundled .NET 10 runtime). The target machine only needs the WebView2 Runtime (built into Windows 11, already present on most Windows 10 installs via Edge).

> Verify: `SHA256SUMS.txt` holds the SHA-256 hashes of both files.
> Uninstall: `msiexec /x Aurora-1.0.0-x64.msi`, or Settings → Apps → Installed apps → Aurora. Uninstalling removes only the program; settings and index under `%LOCALAPPDATA%\Aurora` are preserved.

---

## Run from source

```
run.cmd
```

Double-click `run.cmd` in the repo root. First run auto-runs `dotnet build -c Release`, then launches. You can also run `bin\Release\net10.0-windows\Aurora.exe` directly.

Requirements: Windows 10/11 (with WebView2 Runtime), .NET 10 SDK (only needed for first build).

---

## Why not "a macOS clone"

macOS 27 (Golden Gate, Fall 2026) supports **Apple Silicon only** — Intel Macs are completely dropped. There is no legal way to install or emulate it on an x86 PC. So Aurora's approach: **borrow its design language (frosted glass, traffic lights, rounded corners, restrained accent color) and build genuinely good file management for Windows.**

---

## Features

**Browse**

- Grid / list dual views, `Ctrl+1` / `Ctrl+2` to toggle, adjustable icon size
- Breadcrumb navigation (click any level to jump, `Ctrl+L` to type a path)
- Multi-tab: `Ctrl+T` new, `Ctrl+W` close, `Ctrl+Tab` switch, each tab with independent history
- Back / forward / up, Alt+arrows, Backspace
- Sidebar: quick locations, drives, favorites, recent; drive capacity bar at bottom
- Filters: all / folders / images / documents / code… with counts
- Toggle hidden files
- Info panel: type, size, time, location, tags, six quick actions

**Find**

- Full-drive index + instant search (local database, sub-second results on millions of entries), hit fragments highlighted
- Search results show the parent directory directly — no guessing where a file lives
- Tags + favorites + recent
- Spacebar quick preview: text, code, images, PDF thumbnails, `Esc` to close
- `Ctrl+K` command palette: type to run a command or jump to a path

**Act**

- New folder / text file, rename (F2 inline edit), duplicate
- Copy / cut / paste (cross-drive automatically degrades to "copy + delete"), drag-and-drop move
- Compress to ZIP, extract here
- Send to Recycle Bin (Del, restorable), permanent delete (Shift+Del, double confirmation)
- Reveal in Explorer, Open with, Properties, Open terminal here
- Batch operations (right-click after multi-select)

**AI (bring your own Key)**

| Feature | Description |
| --- | --- |
| Natural-language search | A sentence is decomposed into keywords + type/time filters, then routed through the local index. No vector DB, works offline |
| Ask / summarize | Ask questions about or summarize selected files (docx, txt, md, csv, json, code) |
| Smart rename | Describe a rule → preview table (old name / new name / reason) → confirm before applying |
| Smart organize | Analyze the current folder → propose a grouping plan → confirm to create folders and move files |
| Natural-language commands | One sentence generates an operation plan (mkdir/move/rename/copy/trash) → preview → execute; deletes get an extra confirmation |

Safety boundaries:

- **AI never touches files on its own** — every write requires your confirmation on the preview
- By default only filenames and metadata are sent; file contents are sent only after you check "allow file content"
- API Key is encrypted at rest with Windows DPAPI (`secrets.bin`), never written in plaintext, never sent to a web page, masked in the UI
- Turning off "Enable AI" hides all AI entry points and sends no requests

---

## Configure AI

Settings (`Ctrl+,`) → "AI & Models":

1. Pick a preset (DeepSeek / OpenAI / Anthropic / Gemini / OpenRouter / SiliconFlow / Qwen / local Ollama) or fill in manually
2. Enter Base URL, model name, API Key (not needed for local Ollama)
3. **Protocol**: use "OpenAI-compatible" for almost everything; pick "Anthropic" for the official Anthropic endpoint
4. Click "Test connection" to verify, then "Save provider"

You can also assign a cheaper model specifically for "summary / rename". Multiple providers can coexist; switch which one is active at any time.

---

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+K` | Command palette |
| `Ctrl+F` | Search box |
| `Ctrl+L` | Type a path |
| `Ctrl+T` / `Ctrl+W` / `Ctrl+Tab` | New / close / switch tab |
| `Ctrl+J` | AI assistant |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+N` | New folder |
| `F2` | Rename |
| `Del` / `Shift+Del` | Recycle Bin / permanent delete |
| `Space` | Quick preview |
| `Enter` | Open |
| `Ctrl+A` / `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Select all / copy / cut / paste |
| `Ctrl+1` / `Ctrl+2` | Grid / list |
| `Alt+←` / `Alt+→` / `Alt+↑` | Back / forward / up |
| `F5` | Refresh |

---

## Data & privacy

| Path | Contents |
| --- | --- |
| `%LOCALAPPDATA%\Aurora\settings.json` | Settings, favorites, tags |
| `%LOCALAPPDATA%\Aurora\index.db` | File index (deletable anytime, will be rebuilt) |
| `%LOCALAPPDATA%\Aurora\secrets.bin` | DPAPI-encrypted API Key |
| `%LOCALAPPDATA%\Aurora\thumbs\` | Thumbnail cache (30-day expiry) |

- **The filesystem is the only source of truth**: the index is just a search-acceleration cache; deleting it affects no files.
- No installed service, no process injection, no shell takeover; everything stays inside Aurora's own window. Deleting the program directory affects no files on your drives.

---

## Tech stack

- **.NET 10 WPF** host, WebView2 for rendering, Kestrel on a random `127.0.0.1` port serving a token-authenticated local API
- Frontend is **vanilla HTML/CSS/JS** (no framework, no build step), icons are inline SVG
- **Microsoft.Data.Sqlite** for indexing; thumbnails via `IShellItemImageFactory` for real system thumbnails
- Visual: DWM rounded corners + dark border, wallpaper gaussian-blurred as backdrop, layered frosted glass

### Icons

| Use | Source | License |
|---|---|---|
| UI line icons | [Lucide](https://lucide.dev) | ISC |
| File-type color icons | [vscode-icons](https://github.com/vscode-icons/vscode-icons) | MIT |
| Folder / drive / star / quick locations | hand-drawn gradients | this project |

Icons are extracted at build time by `tools/gen-icons.mjs` from local npm packages and merged into a single `web/icons.js` inline bundle — **no network access at runtime**.

```
Aurora/
├─ App.xaml(.cs)        startup, composition
├─ MainWindow.xaml(.cs) window chrome, DWM, WebView2
├─ Core/                filesystem & data: FsService / FileOps / Indexer / Thumbs / Store / AiService / AiFeatures
├─ Server/              ApiServer / AppState
├─ web/                 index.html · app.css · app.js · icons.js · app-icon.png
├─ installer/            Aurora.wxs · EULA.rtf · banner.bmp · dialog.bmp
├─ dist/                 release artifacts (not in git, go to Releases)
└─ tools/                dev helpers: icon generation, screenshots, icon checks, local fake LLM
```

> Note: `Server\` and `web\` must be separate. On Windows `Web` and `web` are the same directory; putting `ApiServer.cs` under `Web\` earlier caused source files to be served as static assets over HTTP.

### Packaging

```
# 0) First time: install WiX 6 CLI
dotnet tool install --global wix --version 6.0.2

# 1) Self-contained publish
dotnet publish -c Release -r win-x64 --self-contained true -o build\publish

# 2) Build MSI (must run inside installer dir; relative paths resolve against cwd)
cd installer
wix build Aurora.wxs -arch x64 ^
  -bindpath "publish=..\build\publish" ^
  -ext WixToolset.UI.wixext -culture zh-CN ^
  -o ..\build\Aurora-1.0.0-x64.msi
```

The version number has a single source: `<Version>` in `Aurora.csproj`. It is written into the assembly at compile time, used both in `Aurora.exe`'s file properties and exposed via `/api/bootstrap` for the Settings → About display. When bumping the version, also update `Package Version` in `installer\Aurora.wxs` (MSI upgrade detection depends on it).

---

## Known limitations

- Drag-and-drop currently only supports moving within Aurora onto a folder; dragging in from Explorer is not implemented yet
- Copy/cut uses Aurora's internal clipboard and does not write to the system clipboard, so `Ctrl+V` in Explorer won't work
- Deletes go to the Windows Recycle Bin; restore from Explorer (Aurora only sends items in)
- The index defaults to the D: drive; add other drives in Settings as roots and rebuild (any drive can be added — this is just the dev default)
- Full-text content search (not filenames) is not implemented yet; file contents are read on demand only during AI asks

---

## License

[MIT](./LICENSE). Icon assets follow their own licenses: Lucide (ISC), vscode-icons (MIT).
