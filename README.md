# Viewer

一个简单的 Agent 浏览器，网页运行在独立的 `WebContentsView` 中；支持虚拟鼠标与虚拟键盘，通过 Chromium 的可信输入管线操作页面，不移动真实系统光标，也不向页面注入 JavaScript。

[English README](README.en.md) · [设计文档](docs/DESIGN.md)

## 截图

![Viewer 主界面：标签页、网页区与右侧工具面板](docs/screenshots/01-browser.png)

![应用内文件选择器](docs/screenshots/02-file-picker.png)

## 功能

- **自绘浏览器外壳**：无边框窗口、顶部工具栏、左侧垂直标签页、右侧工具面板。每个标签是一个独立的 `WebContentsView`。
- **虚拟鼠标**：可见的橙色光标，支持移动、左键/右键、连击（1–10 次）、滚轮；每个标签独立保存光标位置与显示状态。点击通过 `webContents.sendInputEvent` 注入，页面收到 `isTrusted=true` 的事件，CSS `:hover` 正常生效。
- **虚拟键盘**：英文键盘与文字输入（含中文），通过 `sendInputEvent` 与系统剪贴板实现，同样不注入页面 JS。
- **文件选择器**：通过 CDP 拦截文件选择请求，在应用内展示自绘的文件浏览器（磁盘/上一级/多选/accept 过滤）；这是唯一使用 CDP 的场景。
- **资源分析**：用 `session.webRequest` 观察请求，按标签展示 URL、方法、状态、类型、MIME、耗时与错误，可过滤 XHR/文档/脚本/样式/图片。
- **链接处理**：`target=_blank` 与 `window.open` 转为新标签页，不弹新窗口。

## 安装与运行

需要 Windows 与 Node.js 18+。

从 GitHub 获取：

```bash
git clone https://github.com/SamislandHub/viewer.git
cd viewer
npm install
npm run dev
```

从本地目录运行：

```bash
cd <项目目录>
npm install
npm run dev
```

`npm run dev` 会用 electron-vite 构建主进程、preload 与界面，然后启动 Electron。渲染界面的地址优先取 `ELECTRON_RENDERER_URL`（electron-vite 自动注入实际端口），也可通过 `AI_BROWSER_RENDERER_URL` 或 `VITE_PORT` 覆盖；加载失败会回退到构建好的本地文件。

## 使用

- 地址栏输入网址或搜索词后回车；本地路径（如 `F:\path\file.html`）会转成 `file://` 打开。
- 左侧 `+` 或 `Ctrl+T` 新建标签；点击标签切换；标签加载时显示旋转指示与进度条。
- 右侧「虚拟鼠标」区设置 X/Y（网页/屏幕坐标）、按键、连击次数与滚动量；「显示」控制光标可见性。
- 右侧「虚拟键盘」区可输入文字或点英文键盘；中文通过系统剪贴板 + Ctrl+V 注入。
- 右侧「资源分析」区按类型过滤请求，点击行查看详情；「清空」只清当前标签。

测试页：`test/interaction-test.html` 覆盖文件选择、弹窗、链接、鼠标事件、拖拽、表单、剪贴板、全屏等原生交互。

## 已知限制

- `alert` / `confirm` / `beforeunload` 暂不接管：WebContentsView 无法阻止 Electron 默认弹框，`js-dialog` 事件仅在 `<webview>` guest 上触发。
- `window.prompt` 被 Electron 官方禁用，不产生事件，无法在不注入页面 JS 的前提下接管。
- 虚拟光标所在的约 34×28 区域会拦截真实鼠标（该 Electron 版本的 View 不支持鼠标穿透）；网页其余区域真实鼠标正常。
- 资源分析只记录请求元数据，不记录响应 body——读取 body 需要 CDP，按设计边界未启用。
- 文件选择器需要可信用户手势触发；脚本式 `input.click()` 不算手势。
- 仅支持 Windows（界面与输入注入依赖 Electron Windows 行为）。

## 开发

| 文件 | 作用 |
|---|---|
| `src/main/index.ts` | 入口、IPC、窗口事件、URL 解析、资源推送 |
| `src/main/browser.ts` | 外壳窗口、多标签、光标 View、文件选择状态 |
| `src/main/virtual-mouse.ts` | 每标签的虚拟鼠标状态与输入注入 |
| `src/main/virtual-keyboard.ts` | 文字与按键输入 |
| `src/main/resource-monitor.ts` | `session.webRequest` 资源采集 |
| `src/main/dialog-bridge.ts` | CDP 文件选择拦截（唯一 CDP 场景） |
| `src/renderer/` | 自绘标题栏、左右面板 |

修改 `src/main` 需重启应用；修改 `src/renderer` 在下次构建后生效。运行 `npm run typecheck` 做类型检查，`npm run build` 生成 `out/`。

## 许可证

[MIT](LICENSE) © 2026 SamislandHub
