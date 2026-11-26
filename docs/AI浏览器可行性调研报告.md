# AI 浏览器可行性调研报告（修订版 v2）

> **现状说明（2026-11-26）**：这是早期可行性调研，部分结论已被后续实现取代，阅读时以 `README.md`、`docs/DESIGN.md`、`docs/项目交接.md` 为准。
>
> - 输入不再是 `SendInput` / 系统级真实鼠标，改为 `webContents.sendInputEvent`（不移动真实光标）
> - 不向页面注入 JS；CDP 只用于文件选择和 UA Client Hints
> - `alert` / `confirm` / `prompt` 已通过 `disableDialogs` 直接禁用，不再尝试接管
> - 原文中的视觉定位、截图感知等方案未采用

- 调研时间：2026-11-25
- 场景：**自有系统 / 内部测试**
- 方案定位：**源码 + 接口驱动的拟人输入自动化**（非截图感知）

> 修订说明：v1 报告假设 AI 通过截图感知屏幕。用户澄清后，方案变更为「AI 分析目标页面源码与接口契约来决策，通过系统级拟人鼠标/键盘执行，Electron 自带 Chromium 是唯一内核」。本报告按新前提重写，v1 中关于视觉定位风险的大部分内容不再适用。

---

## 一、最终方案定义

| 维度 | 确定方案 |
|---|---|
| AI 的感知输入 | 目标页面**源码**、HTTP API 契约（OpenAPI/GraphQL）、代码层接口，以及运行时只读观察（DOM / AXTree / 网络请求） |
| AI 的感知排除 | **不做截图分析**，不依赖像素、OCR、视觉定位模型 |
| 执行方式 | 系统级 `SendInput` 产生**真实鼠标/键盘事件**，轨迹拟人、光标可见；**不通过浏览器 API 直接操作 DOM** |
| 浏览器内核 | **仅 Electron 自带 Chromium**；通过 `webContents.debugger` 挂 CDP 做只读观察，不启动第二个浏览器内核（不用 Playwright 自带 Chromium） |
| 工作节奏 | **离线**从源码编译出确定性脚本；**运行时** AI 仅在异常与自愈时介入 |
| 场景边界 | 自有系统内部测试；拟人输入用于验证真实 UI 交互链路，不用于规避第三方风控 |

### 核心洞察

源码世界和物理鼠标世界之间缺一座桥：

```
源码里的语义        "提交订单按钮"
   ↓ 解析
选择器              #submit-order
   ↓ CDP 只读观察（执行前一刻）
元素几何位置        DOM.getBoxModel → CSS 像素矩形
   ↓ 坐标换算
屏幕物理坐标        虚拟桌面绝对坐标
   ↓ SendInput
真实鼠标点击        拟人轨迹 → mouseDown → mouseUp
```

**源码告诉 AI「点什么」，CDP 告诉系统「现在在哪里」，SendInput 完成「怎么点」。** 这三层职责必须分开，否则要么退化成脆弱的 DOM 直操，要么退化成昂贵的视觉猜测。

---

## 二、结论摘要

| 维度 | 判断 |
|---|---|
| 技术可行性 | ✅ **高于纯视觉路线**，原型 1–2 周，稳定可用 3–6 周 |
| 主要工程难点 | 不是 AI 能力，而是**坐标桥的鲁棒性**与**源码版本一致性** |
| 单步成本 | 正常路径**近乎为零**（无模型调用）；异常自愈时才调用 LLM |
| 单步延迟 | 拟人轨迹本身 0.3–1.7 秒/次移动；无模型推理开销 |
| 可靠性 | 主流程是确定性脚本，可做到 >99%/步；AI 只处理例外 |
| 最大风险 | 源码与线上页面版本漂移、滚动/动画导致的坐标偏移、OS 级输入静默失败 |

**一句话结论**：这条路比截图方案**更靠谱**。AI 从「每一步都要猜坐标的驾驶员」变成「离线写脚本的工程师 + 运行时救火的运维」，成本和稳定性都大幅改善。真正要攻克的工程问题是**稳定地把选择器映射成执行瞬间的屏幕坐标**。

---

## 三、为什么放弃截图感知（对照数据，简述）

v1 调研中的量化证据，恰好说明新方案规避了什么：

- 失败任务中 **23%** 是「规划正确但坐标错误」；>50 步的失败任务里 **66% 的步骤浪费在定位循环**（[OSWorld-Human](https://arxiv.org/abs/2506.16042)）。
- 密集小控件定位精度从 88.8% 掉到 26.8%（[ScreenSpot-Pro](https://ar5iv.labs.arxiv.org/html/2604.21268)）。
- 1920×1080 截图约 2,000 图像 token，历史每轮重传，成本随步数近似平方增长。
- [ERPBench](https://arxiv.org/html/2609.17885v1) 证明「界面看着成功、数据实际错误」——视觉确认本身就不可靠。

新方案用源码语义 + 网络断言替代了上述全部环节。

---

## 四、推荐架构

```
┌──────────────────────────────────────────────────────────────────┐
│ Electron 应用（唯一 Chromium 内核）                                │
│                                                                    │
│  【离线层】                                                        │
│  ┌────────────────┐    ┌──────────────────┐                        │
│  │ 源码/接口分析器  │───▶│ 任务编译器        │                        │
│  │ 页面源码 + 契约  │    │ 产出 Skill 脚本    │                        │
│  └────────────────┘    └────────┬─────────┘                        │
│                                 │                                  │
│  【运行时层】                    ▼                                  │
│  ┌────────────────┐    ┌──────────────────┐    ┌───────────────┐   │
│  │ 异常自愈 AI      │◀───│ 执行器（确定性）   │───▶│ 坐标桥         │   │
│  │ 仅失败时调用     │    │ 拟人鼠标/键盘     │    │ CDP 读 box     │   │
│  └────────┬───────┘    └────────┬─────────┘    └───────┬───────┘   │
│           │                     │                      │           │
│  ┌────────▼────────┐    ┌────────▼─────────┐    ┌───────▼───────┐   │
│  │ 观察层（只读）    │    │ BrowserView      │    │ Overlay       │   │
│  │ CDP: DOM/Net/AX  │◀───│ 目标页面         │    │ 虚拟光标/高亮  │   │
│  └─────────────────┘    └──────────────────┘    └───────────────┘   │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ Win32 SendInput（OS 级真实输入）
                                  ▼
                        系统光标移动 / 点击 / 键盘输入
```

**关键约束落实**：

- `webContents.debugger.attach('1.3')` 直接挂在加载目标页面的 `BrowserView` / `WebContentsView` 的 `webContents` 上。
- 只调用**只读** CDP 方法：`DOM.getDocument`、`DOM.querySelector`、`DOM.getBoxModel`、`Runtime.evaluate`（只读表达式）、`Network.enable` + 网络事件、`Accessibility.getFullAXTree`、`Page.getFrameTree`。
- **禁止**调用 `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Runtime.evaluate` 执行点击脚本——所有输入走 `SendInput`。
- 不引入 `playwright`、`puppeteer` 及其自带内核；若确实想要 Playwright API，可用 `chromium.connectOverCDP()` 连接 Electron 的调试端点，但直接 `webContents.debugger` 更轻、更可控，**推荐后者**。

---

## 五、核心模块详解

### 5.1 源码与接口分析器（离线）

输入：目标页面源码仓库路径 + API 契约文件（OpenAPI/Swagger/GraphQL schema）+ 代码层接口定义。

输出一张 **UI 元素注册表**：

```ts
interface UIRegistryEntry {
  id: string;                  // 'submit-order'
  selector: string;            // '#order-form button[type=submit]'
  description: string;         // '订单提交按钮'
  expectedState?: string;      // 'enabled, visible'
  apiEndpoint?: string;        // 'POST /api/orders'
  sourceRef: string;           // 'src/pages/Order.tsx:142'
  sourceVersion: string;       // git commit / build hash
}
```

实现要点：

- 大仓库不要全量塞给模型：先做轻量索引（按路由/组件切分），或用 RAG 检索相关文件片段，再把片段交给 LLM 提取元素语义。
- **必须绑定源码版本**：注册表里的 `sourceVersion` 要和当前部署的页面构建 hash 一致。版本漂移时强制重新分析——这是最重要的一致性护栏。
- API 契约用于生成断言，而不是用于替代 UI 操作：例如知道 `POST /api/orders` 成功返回 201，就能在运行时通过 CDP 网络事件验证。

### 5.2 任务编译器与 Skill DSL（离线）

AI 把「自然语言测试目标 + UI 注册表 + API 契约」编译成受限 DSL 脚本。**DSL 只允许声明式步骤，不允许任意代码执行**。

```
skill CreateOrder {
  param user, password, itemId

  step navigate("https://internal.example.com/orders")
  step waitForSelector("#order-form", timeout: 10s)
  step focus(selector: "#username")
  step type(text: $user, human: true)          // 逐字延迟 + 偶发打字错误可选
  step click(selector: "#login-btn", human: true)
  step waitForNetwork("POST /api/login", status: 200)

  step click(selector: "#item-" + $itemId, human: true)
  step click(selector: "#submit-order", human: true)
  step waitForNetwork("POST /api/orders", status: 201)
  step assertSelector(".order-success", visible: true)
  step assertNetwork("POST /api/orders", responseBody: { status: "created" })
}
```

- `click` / `type` / `focus` 只描述**意图**，坐标在运行时由坐标桥实时计算。
- `human: true` 控制是否启用拟人轨迹；关键路径强制开启。
- 编译结果固化成 JSON/YAML，可 diff、可 review、可回放。

### 5.3 只读观察层（CDP，单内核）

挂在 Electron 自己的 `webContents` 上：

```ts
webContents.debugger.attach('1.3');
await webContents.debugger.sendCommand('DOM.enable');
await webContents.debugger.sendCommand('Network.enable');
```

用途：

| CDP 能力 | 用途 |
|---|---|
| `DOM.querySelector` / `getBoxModel` | 执行前实时取元素矩形（坐标桥的数据源） |
| `DOM.getDocument` / `DOM.getOuterHTML` | 异常时给自愈 AI 提供页面结构上下文 |
| `Network.requestWillBeSent` / `responseReceived` | 验证 API 调用结果与业务断言 |
| `Runtime.evaluate`（只读表达式） | 取 `scrollX/scrollY`、`devicePixelRatio`、`innerWidth` 等几何参数 |
| `Accessibility.getFullAXTree` | 辅助判断元素状态（可见/禁用/展开） |
| `Page.getFrameTree` | 处理 iframe 内的元素定位 |

**注意**：`getBoxModel` 返回的是相对主 frame 视口的 CSS 像素坐标，需要叠加滚动偏移与 frame 偏移。

### 5.4 坐标桥（本项目最关键模块）

换算链路：

```
1. DOM.getBoxModel(selector) → CSS 像素矩形 {x, y, width, height}
2. 取中心点：cx = x + width/2, cy = y + height/2
3. 叠加滚动：cx -= scrollX, cy -= scrollY
4. 叠加 iframe 偏移（如有）：+ frame.offset
5. × devicePixelRatio → 物理像素
6. + display.bounds.origin（DIP→物理）→ 虚拟桌面物理坐标
7. × 65535 / virtualDesktopSize → MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK
8. SendInput
```

鲁棒性要求：

- **点击前一刻才重新查询坐标**，不要缓存。页面滚动、懒加载、动画、sticky header 都会让旧坐标失效。
- 点击前做**可见性预检**：矩形宽高 > 0、中心点落在视口内、未被遮挡（可用 `document.elementFromPoint` 只读检查）。
- 多显示器负坐标：主屏左上角是 (0,0)，左侧/上方显示器为负值，`MOUSEEVENTF_VIRTUALDESK` 必须开。
- 监听 `display-metrics-changed` / `display-added` / `display-removed`，重建 Overlay 与坐标映射。
- 元素漂移超阈值（例如 >40px）时中止并触发自愈，不要「盲点」。

### 5.5 拟人输入执行器

| 能力 | 实现 |
|---|---|
| 鼠标移动 | 单侧控制点贝塞尔曲线 + Fitts 定律决定采样数；远距离 overshoot 后回修 |
| 时间节奏 | <200px: 280–350ms / 30–40 点；200–800px: 400–900ms / 40–80 点；>800px: 900–1700ms / 80–96 点（[Peekaboo 参数](https://raw.githubusercontent.com/openclaw/peekaboo/cd4b64318a0944c3e14f6e952b5c1f1e99fba714/docs/human-mouse-move.md)） |
| 微抖动 | minimum-jerk 时间曲线；垂直抖动 ≤0.35px/帧；终点精确对齐；种子化随机可复现 |
| 点击 | `mouseDown → 随机 hold → mouseUp`，独立事件间隔 0.38–0.45s 基准 + 抖动 |
| 键盘 | 逐字延迟 + 正态分布 jitter；可选偶发退格重打（仅在明确允许时） |
| 安全守卫 | 动作 ledger + `finally` 补释放；`RELEASE_UNCONFIRMED` 告警；只有 `not_delivered` 才安全重试 |

参考实现：[ghost-cursor 轨迹算法](https://github.com/xetera/ghost-cursor)。

**SendInput 注意点**（[MS 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)）：

- UIPI 会**静默拦截**对更高完整性级别窗口的注入（返回值仍成功）→ 预检完整性级别、注入后回读 `GetCursorPos` 验证。
- 精细轨迹/拖拽加 `MOUSEEVENTF_MOVE_NOCOALESCE`，避免 `WM_MOUSEMOVE` 被合并。
- 相对位移受指针加速影响，统一用绝对坐标。
- 从 Electron 主进程用 `koffi` / `node-ffi-rs` 调 `user32.dll`，不要每个动作 spawn PowerShell 子进程。

### 5.6 验证与异常自愈

**验证（正常路径，无 AI）**：

- 网络断言：CDP 捕获的响应状态码、响应体字段（来自 API 契约）。
- DOM 断言：元素存在性、可见性、文本、禁用态。
- 必要时直连数据库/内部 API 校验最终业务状态——**不依赖「看起来对」**。

**自愈（异常路径，才调用 AI）**：

触发条件：元素未找到、坐标漂移超阈值、超时、断言失败、意外弹窗、连续失败 ≥2 次。

输入给 AI 的上下文：当前 DOM 快照（文本，非截图）、网络事件序列、相关源码片段（按选择器反查）、失败步骤与错误类型、最近 N 步轨迹。

AI 输出：修正后的选择器 / 新增一个等待步骤 / 换用备用路径 / 判定失败。

护栏：

- 最大自愈次数（如 3 次），超出转人工。
- 凭据输入、提交/支付类不可逆操作、连续失败 → 强制 human-in-the-loop 审批。
- 紧急停止快捷键；失焦即暂停；目标窗口句柄每步校验。

---

## 六、技术选型与约束落实

| 项 | 选择 | 理由 |
|---|---|---|
| 浏览器内核 | Electron 自带 Chromium | 用户明确要求，不引入第二个内核 |
| CDP 接入 | `webContents.debugger` | Electron 原生支持，只读观察足够，无额外依赖 |
| 输入注入 | Win32 `SendInput`（主进程 + koffi） | 唯一同时满足「真实光标 + OS 级可信事件 + 拟人轨迹」的用户态方案 |
| 截图 | **不需要** | AI 不靠视觉决策；截图仅作可选的人工回放证据 |
| 框架 | 自建轻量内核 | Stagehand/Playwright/Skyvern 都会引入自己的浏览器或抽象层，与约束冲突；BrowserGym 仅作为评测思路参考 |
| 源码索引 | AST 解析 + 轻量 RAG | 避免全量源码进 context |
| Trace | 自建 + 可选 Langfuse | 记录源码版本、skill 版本、步骤、网络断言、自愈记录、耗时 |

---

## 七、风险清单与护栏

| 风险 | 表现 | 护栏 |
|---|---|---|
| **源码/构建版本漂移** | 分析的源码与线上页面不一致，选择器失效 | `sourceVersion` 绑定构建 hash，不一致时强制重分析 |
| **坐标漂移** | 滚动、动画、懒加载使点击落到错误元素 | 执行前一刻重新取 box + 可见性预检 + 漂移阈值中止 |
| **输入静默丢失** | UIPI 拦截仍返回成功 | 完整性预检 + 光标回读 + 网络/DOM 闭环验证 |
| **按键状态泄漏** | 异常中断后鼠标/键卡住 | ledger + finally 补释放 + 告警 |
| **焦点竞争** | 输入打到错误窗口 | 每步校验 `GetForegroundWindow`，失焦暂停 |
| **多屏 DPI** | 负坐标、缩放错误 | 统一坐标层 + `VIRTUALDESK` + 监听 display 事件 |
| **自愈失控** | AI 反复改脚本导致更长循环 | 次数预算 + 人工接管点 + 动作 DSL 限制 |
| **覆盖盲区** | 纯源码/接口分析测不出视觉回归 | 保留少量视觉快照作为**人工审查证据**（不进 AI 决策环） |
| **源码敏感信息** | 源码/契约含密钥或隐私 | 本地分析优先；脱敏后再送外部 LLM；提供纯本地模型选项 |

---

## 八、落地路线与验收标准

### Phase 0 — 打通三层链路（1–2 周）

- Electron 加载自有系统页面；`webContents.debugger` 只读挂接。
- 源码分析器产出 3–5 个元素的 UI 注册表。
- 坐标桥：选择器 → box model → SendInput → 真实点击。
- 拟人轨迹最小实现（贝塞尔 + 缓动）。

**验收**：对一个固定按钮，连续 50 次点击命中率 100%，无按键卡死。

### Phase 1 — 离线编译与断言（2–3 周）

- 任务编译器 + Skill DSL；网络/DOM 断言。
- 源码版本绑定与漂移检测。
- Trace 记录与回放。

**验收**：1 条完整业务流程（10+ 步）连续跑 20 次，成功率 ≥95%，失败可归因。

### Phase 2 — 异常自愈与人工接管（2–3 周）

- 触发式 AI 自愈（DOM 文本上下文，非截图）。
- 审批门、紧急停止、多屏 DPI、Overlay 完整化。

**验收**：注入 20 种人为异常（改选择器、弹窗、超时），自愈成功率 ≥80%，其余正确转人工。

### Phase 3 — 规模化（持续）

- 沉淀 Skill 库；CI 门禁；本地模型降本。
- 视觉快照仅作人工审查证据。

**验收**：回归套件纳入 CI，误报率 <2%。

---

## 九、下一步建议

1. **先做 Phase 0 的坐标桥验证**（强烈推荐）：这是全项目风险最高的环节。我可以直接在空工作区初始化 Electron 项目，用一个测试页面把「选择器 → CDP box → SendInput 命中」跑通，并统计 100 次命中率。
2. **先定义 Skill DSL 与源码注册表 schema**：把接口契约定下来，后续模块可并行开发。
3. **先接一个真实自有系统页面**：用你实际要测的页面做端到端验证，而不是用 demo 页面。

---

## 参考来源

- [OSWorld-Human：延迟分解与定位失败分析](https://arxiv.org/abs/2506.16042)
- [ScreenSpot-Pro 定位落差](https://ar5iv.labs.arxiv.org/html/2604.21268)
- [ERPBench：界面成功 ≠ 数据正确](https://arxiv.org/html/2609.17885v1)
- [Electron debugger API（CDP）](https://www.electronjs.org/docs/latest/api/debugger)
- [MS SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) / [MOUSEINPUT](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-mouseinput)
- [ghost-cursor 轨迹算法](https://github.com/xetera/ghost-cursor) / [Peekaboo human profile](https://raw.githubusercontent.com/openclaw/peekaboo/cd4b64318a0944c3e14f6e952b5c1f1e99fba714/docs/human-mouse-move.md)
- [Electron 透明悬浮窗 Windows 踩坑实录](https://amefys.com/blog/electron-overlay-pitfalls.html)
