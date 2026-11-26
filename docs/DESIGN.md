# Viewer 设计说明

Viewer 是一个用于自有系统内部测试的自定义浏览器。核心目标：界面与原生交互由应用自身掌控，同时不向目标页面注入代码、不干扰用户真实鼠标。

## 1. 架构

```
Electron 主进程
├─ BrowserWindow (frame:false)
│  ├─ 外壳 renderer：工具栏 / 垂直标签 / 右侧面板
│  ├─ 每标签一个 WebContentsView（独立 webContents）
│  └─ 透明光标 WebContentsView（网页上一层，约 34×28）
├─ VirtualMouse / VirtualKeyboard  → webContents.sendInputEvent
├─ ResourceMonitor                 → session.webRequest
└─ DialogBridge                    → CDP（仅文件选择）
```

外壳渲染层在网页区域透明，网页 View 位于其下；光标 View 位于其上。窗口尺寸变化时三者同步更新 bounds。

## 2. 关键决策

- **单内核**：只用 Electron 自带 Chromium，不引入 Playwright/Puppeteer。
- **不注入页面 JS**：不用 `executeJavaScript`、`eval`、`dispatchEvent`，不直接调用 DOM 的 `click()`。输入走 Chromium 输入管线，页面看到的是 `isTrusted=true` 的可信事件。
- **不动真实光标**：移除 koffi/SendInput，虚拟光标只是应用内的绘制层。
- **每标签独立状态**：标签、虚拟鼠标、文件选择器、资源日志都按 `webContentsId` 或标签 ID 隔离。
- **CDP 最小化**：只有文件选择因 Electron 无对应公开 API 而使用 CDP（`Page.setInterceptFileChooserDialog` / `DOM.setFileInputFiles`），其余能力用 Electron API。

## 3. 输入模型

虚拟鼠标用贝塞尔轨迹逐点移动，点击分左键/右键与 1–10 连击，滚轮通过 `mouseWheel` 事件注入。虚拟键盘用 `char` 事件输入 ASCII，中文通过系统剪贴板 + Ctrl+V 注入。所有事件通过 `webContents.sendInputEvent` 发给当前标签（文件选择器打开时临时切到光标 View）。

这样做的收益：页面无法从事件本身区分是真实输入还是虚拟输入；`navigator.webdriver` 等自动化标志不会被设置。

## 4. 原生交互边界

| 行为 | 状态 | 原因 |
|---|---|---|
| 文件选择 | 已接管 | CDP 拦截 + 应用内文件浏览器 |
| `_blank` / `window.open` | 已接管 | `setWindowOpenHandler` → 新标签 |
| `alert` / `confirm` / `beforeunload` | 未接管 | WebContentsView 无阻止默认弹框接口；`js-dialog` 仅 `<webview>` guest 触发 |
| `window.prompt` | 不可接管 | Electron 官方禁用，不产生事件 |

详细的失败模式与取舍见 [AI浏览器可行性调研报告](AI浏览器可行性调研报告.md)。

## 5. 资源分析

`ResourceMonitor` 使用 `session.webRequest` 的 `onResponseStarted` / `onCompleted` / `onErrorOccurred`。未注册 `onBeforeRequest`：在本项目使用的 Electron 版本中，仅注册该监听器就会阻塞主窗口 renderer 完成加载。采集结果按 `webContentsId` 存入环形缓冲（每标签 500 条），通过 IPC 推送到右侧面板。

响应 body 未采集——读取 body 需要 CDP，与「CDP 最小化」的边界冲突。

## 6. 已知限制

- 光标 View 没有鼠标穿透 API（Electron 45 的 `WebContentsView` 不支持 `setIgnoreMouseEvents`），光标所在的 34×28 区域会拦截真实鼠标。
- 文件选择需要可信用户手势触发。
- 多用户隔离、响应体分析、下载与权限请求的接管尚未实现，评估见项目交接文档。

## 7. 技术栈

Electron 45 · electron-vite 6 · Vite 8 · TypeScript 5.9 · 无运行时第三方依赖。
