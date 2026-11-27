# Viewer 设计说明

Viewer 是一个简单的 Agent 浏览器，网页运行在独立的 `WebContentsView` 中；支持虚拟鼠标与虚拟键盘，通过 Chromium 的可信输入管线操作页面，不移动真实系统光标，也不向页面注入 JavaScript。核心目标：界面与原生交互由应用自身掌控，同时不干扰用户真实鼠标。

## 1. 架构

```
Electron 主进程
├─ BrowserWindow (frame:false)         主窗口
│  ├─ 工具栏 WebContentsView（导航 / 收藏 / 元素选择 / 截图 / 窗口控制）
│  ├─ 侧边栏 WebContentsView（垂直标签 / 下载入口）
│  ├─ 每标签一个 WebContentsView（独立 webContents，含 Viewer 内置页）
│  └─ 透明光标 WebContentsView（网页上一层，约 34×28）
├─ BrowserWindow (frame:false)         虚拟控制台（独立、无 parent、默认隐藏）
│  └─ 虚拟鼠标 / 虚拟键盘 / 资源分析
├─ VirtualMouse / VirtualKeyboard  → webContents.sendInputEvent
├─ ResourceMonitor                 → session.webRequest
├─ Fingerprint                     → app.userAgentFallback + CDP Emulation
├─ BookmarkStore                   → data/bookmarks.json
├─ HistoryStore                    → data/history.json
├─ DownloadManager                 → session will-download → data/downloads
├─ FileManager / Preview           → viewer://files + viewer://preview
└─ FileChooserBridge               → CDP（文件选择 + 元素选择，共用同一调试会话）
```

工具栏与侧边栏是网页层之上的独立 View，避免外壳与页面争抢焦点；地址栏编辑时物理键盘事件会被转发到工具栏 View。控制台是独立窗口：没有 `parent`，因此网页的原生模态框不会禁用它的输入控件。窗口尺寸变化时所有 View 的 bounds 同步更新。

## 2. 关键决策

- **单内核**：只用 Electron 自带 Chromium，不引入 Playwright/Puppeteer。
- **不注入页面 JS**：不用 `executeJavaScript`、`eval`、`dispatchEvent`，不直接调用 DOM 的 `click()`。输入走 Chromium 输入管线，页面看到的是 `isTrusted=true` 的可信事件。
- **不动真实光标**：移除 koffi/SendInput，虚拟光标只是应用内的绘制层。
- **每标签独立状态**：标签、虚拟鼠标、文件选择器、资源日志都按 `webContentsId` 或标签 ID 隔离。
- **CDP 最小化**：仅三处使用 CDP：
  1. 文件选择（Electron 无对应公开 API）
  2. UA Client Hints 覆盖（`Emulation.setUserAgentOverride`，浏览器级，不执行页面脚本）
  3. 元素选择（`Overlay.setInspectMode` + `inspectNodeRequested`，DevTools 原生高亮，不执行页面脚本）
- **下载不弹原生框**：`will-download` 是 session 级事件，只注册一次；文件统一落到 `data/downloads`，进度由主进程推送给外壳面板。
- **原生弹框直接禁用**：标签页 `disableDialogs: true`，不再尝试接管 alert/confirm。
- **外壳分层**：工具栏与侧边栏用独立 WebContentsView 叠加在网页上，避免页面抢占地址栏焦点；键盘事件在 url 输入期间从子 View 转发回工具栏。
- **本地路径进入内置页**：存在的本地路径转成 `viewer://files/<path>` 或 `viewer://preview/<path>`，不再直接 `file://` 打开；文件管理提供新建/重命名/复制/移动/删除，预览仅支持图片与 2 MB 内文本。

## 3. 输入模型

虚拟鼠标用贝塞尔轨迹逐点移动，点击分左键/右键与 1–10 连击，滚轮通过 `mouseWheel` 事件注入。虚拟键盘用 `char` 事件输入 ASCII，中文通过系统剪贴板 + Ctrl+V 注入。所有事件通过 `webContents.sendInputEvent` 发给当前标签（文件选择器打开时临时切到光标 View）。

这样做的收益：页面无法从事件本身区分是真实输入还是虚拟输入；`navigator.webdriver` 等自动化标志不会被设置。

## 4. 原生交互边界

| 行为 | 状态 | 原因 |
|---|---|---|
| 文件选择 | 已接管 | CDP 拦截 + 应用内文件浏览器 |
| 元素选择 | 已接管 | CDP `Overlay` 检查模式，点击元素返回节点信息 |
| 下载 | 已接管 | session `will-download` → `data/downloads` + 自绘进度面板 |
| `_blank` / `window.open` | 已接管 | `setWindowOpenHandler` → 新标签 |
| `alert` / `confirm` / `beforeunload` | 已禁用 | `disableDialogs: true`，不弹原生框 |
| `window.prompt` | 不可用 | Electron 官方禁用，调用直接抛错 |
| HTTP 认证 / 证书错误 | 未接管 | 只有 `login` / `certificate-error` 事件，无 UI |

详细的失败模式与取舍见 [AI浏览器可行性调研报告](AI浏览器可行性调研报告.md)，Electron 与 Chrome 的完整差异见 [README](../README.md#electron-与-chrome-的差异)。

## 5. 资源分析

`ResourceMonitor` 使用 `session.webRequest` 的 `onResponseStarted` / `onCompleted` / `onErrorOccurred`。未注册 `onBeforeRequest`：在本项目使用的 Electron 版本中，仅注册该监听器就会阻塞主窗口 renderer 完成加载。采集结果按 `webContentsId` 存入环形缓冲（每标签 500 条），通过 IPC 推送到控制台窗口。

响应 body 未采集——读取 body 需要 CDP，与「CDP 最小化」的边界冲突。

## 6. 指纹对齐

`Fingerprint` 在不注入页面脚本的前提下尽量对齐 Chrome：

- `app.userAgentFallback` / `session.setUserAgent`：UA 与内置 Chromium 版本一致，去掉 `Electron/x.y.z`
- CDP `Emulation.setUserAgentOverride`：`navigator.userAgentData.brands` 补上 `Google Chrome`，并对齐 `platform`、`fullVersionList`、`acceptLanguage`
- 标签创建与每次 `did-finish-load` 后重新应用

仍无法在不注入脚本的前提下修改：`window.chrome.runtime`、`Notification.permission`（默认 `granted`）。

## 7. 已知限制

- 文件选择需要可信用户手势触发。
- `confirm()` 固定返回 `false`，依赖「确定」分支的业务逻辑需改为页面内弹框。
- 多用户隔离、响应体分析、权限请求的接管尚未实现，评估见项目交接文档。

## 8. 技术栈

Electron 45 · electron-vite 6 · Vite 8 · TypeScript 5.9 · 无运行时第三方依赖。
