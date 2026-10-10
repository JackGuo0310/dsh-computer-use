# Cua Driver 迁移状态与能力边界

决策日期：2026-10-09。用户已批准全面切换到 Cua Driver，以取代自研 .NET UIA/Win32 helper。本文只记录当前实现、验证范围和后续能力门禁，不把计划中的功能描述为已实现。

## 当前状态

- 锁定 `@trycua/cua-driver@0.28.0`；运行时代码选用 SDK-managed private worker。阶段 A 静态证据见 [STAGE-A.md](<STAGE-A.md>)。
- 插件只开放 `safe_win_list_windows` 和 `safe_win_observe`。动作工具未注册；不发送输入。
- 串行与取消语义集中在 `src/operation-queue.js`（不 import Cua SDK）：同一 runtime 一次只发一个 driver 调用；超时或 abort 只让调用方停止等待，worker 仍可能在跑该调用，因此被放弃的调用会把 runtime 置为 quarantine，直到 worker 真正报告结束前拒绝新调用，关闭时先在有界预算内 drain 再 shutdown。这条不变量是为将来动作门禁准备的，本身仍不执行动作。
- private worker 的启动选项集中在 `src/driver-options.js`，并由桌面无关测试对着**真实 SDK** 断言整份记录。已核实 `RuntimeAuthorizationOptions.create` / `PrivateWorkerOptions.create` 只是 `Object.freeze({...defaults(), ...partial})`，**不做任何校验**：误写类型、越界权限模式会被原样接受，拼错的键会作为多余字段保留、让对应选项静默回到默认值。因此授权上限（仅 Standard、`unrestrictedAcknowledged: false`、TTL 上限）必须靠断言而非类型系统保证。该测试只 import SDK 载入库，不调用任何 driver 方法。
- 窗口按配置的 executable 文件名或绝对路径白名单过滤；观察绑定到 fresh listing 的 PID 与 bigint window ID，且过滤结果不向模型泄露 element token。
- 快照的完整性判定与边界投影集中在 `src/snapshot-policy.js`（不 import Cua SDK），因此该部分可在不加载原生插件的进程内测试：拒绝非目标窗口、degraded、静默不完整元素集与失效截图帧，并对 element 数、文本长度与图像字节设上限。显式 `truncated` 仍作为可见信息返回，不冒充完整快照。
- `safe_win_observe` 的截图选项当前拒绝 `true`，直到 DSH 图像附件/渲染链路得到验证；tree-only 观察使用 `false`。
- Cua SDK/worker 未安装或运行，未真实枚举桌面、截图或发送输入。Worker 可用性、真实应用可访问性、截图输出及附件链路均未实测。
- SDK 的 Node native addon 仍在 DSH host 进程加载。private worker 隔离桌面 driver runtime 进程生命周期，不是 OS 沙箱，也不隔离 host native addon 自身崩溃。
- `src/policy.js` 留有动作门控逻辑，但当前插件不调用它执行动作；不得将其视为已开放能力。

## 安全约束

- 仅 Windows；白名单为非空 executable 文件名**或绝对路径**，不是签名认证。路径项只匹配该绝对路径，文件名项只匹配可执行文件名，两者互不替代。
- Cua window ID 在内部保留 bigint；DSH JSON 输出转为十进制字符串。
- 插件不向模型暴露上游完整工具目录或 arbitrary `callTool`。
- 不允许前台 fallback、自动重试模糊输入或输入动作绕过 DSH 执行入口。
- Cua 文本/图像都是不可信数据。标题/控件关键词过滤只能作为保守措施，不能完整识别业务风险。
- 未经针对具体运行的批准，不枚举真实桌面、不截图、不发输入。当前迁移授权不等于 live-run 授权。

## 能力准入门槛

增加输入动作前，须验证选定 SDK 版本的后台目标语义、delivery 状态与失败/取消行为；通过 DSH 一次性审批，并在审批后重验进程、窗口、快照、目标 token 和 driver generation。拒绝、缺失、取消或目标变化必须拒绝；送达状态模糊时不可重放。取消语义的插件侧前提（一次只跑一个调用、被放弃的调用隔离 runtime、不可自动重放）已由 `src/operation-queue.js` 固化。**后台元素点击的目标语义与 delivery 状态已由 2026-10-10 的 live 实测验证通过（见下）；文字输入实测需要窗口焦点，失败/取消路径、审批后重验链路与前台投递通路仍未验证，因此动作工具仍未注册。**

### 后台点击的 live 实测结论（2026-10-10，仅记事本）

在用户授权下，用 `scripts/verify-live-cua.mjs` 对记事本**前台**窗口的「加粗(Ctrl+B)」按钮（snapshot index 11，`actions: ["toggle"]`）发了一次后台元素点击：

- 驱动返回 `effect: unverifiable`、`route: accessibility`、`delivery.mode: background`、`evidenceCount: 0`
- 重新观察：元素数 30 → 31，元素标签序列变化，用户确认按钮变为按下态

结论：**0.28.0 的后台语义点击确实送达并生效**，但驱动自述 `unverifiable` 与实际生效不一致。由此确定两条设计规则：

1. 驱动的 `ActionResult` **不是**效果证据；效果只能由同一窗口的 fresh snapshot 确认。
2. `unverifiable` 不等于失败，**也不构成重发许可**——送达状态模糊时不可重放。

### 真正后台窗口的送达（2026-10-10，同一按钮复测）

第一次点击时记事本是前台窗口。复测时保持 Chrome 在前台，记事本为「在屏但非激活」的后台窗口（`IsIconic` 为 false、`GetForegroundWindow` 属于 Chrome），对同一个 index 11 元素再发一次后台点击：

- 驱动返回与前台那次**完全一致**：`effect: unverifiable`、`route: accessibility`、`delivery.mode: background`
- 元素数 30 → 31、标签序列变化，用户确认按钮在**未获得焦点的情况下**仍变为按下态

结论：**后台语义点击是硬能力**。UIA 通路直接作用于指定窗口，不需要前台、不抢焦点、不移动系统指针。门槛中最关键的一项（后台目标语义 + delivery 状态）已验证通过。

仍未验证：失败/取消路径、多动作连续性、坐标点击、非 toggle 类控件的效果确认方式，以及审批后重验链路。因此动作工具**仍未注册**，下一步是先把这些补齐再接线。

最小化窗口会被 `listWindows({ onScreenOnly: true })` 过滤掉，因此不可观察也不可点击——这是有意的拒绝，不是缺陷。

### 打字与按键需要焦点（2026-10-10）

给 adapter 加了 `typeText` / `pressKey` 后实测：

- **后台窗口**（Chrome 持焦点）输入 27 字符：驱动自述 `Sent 27 char(s) via PostMessage ... could not read the focused field back, e.g. the target isn't foreground`，而窗口字符数**停在 0**——文字没有进入文档。
- **前台窗口**同样输入：字符数客观递增 **0 → 27 → 39 → 49**，截图确认三行文字与换行均正确。

因此当前能力边界是明确的：

| 能力 | 后台 | 前台 | 证据 |
|---|---|---|---|
| 元素点击 | 可用 | 可用 | `route: accessibility`，窗口改变且不抢焦点 |
| 文字输入 | **失败** | 可用 | 后台自述成功但字符数不变 |
| 按键 | 未单独验证 | 可用 | 换行正确生效 |

`typeText` / `pressKey` 的 SDK 输入类型里**没有 `deliveryMode` 字段**（不同于 `click` 的必填 `deliveryMode`），但驱动失败时明确建议 `retry with delivery_mode:"foreground"`。说明存在本插件尚未暴露的前台投递通路；该通路未定位前，**文字输入按需要焦点对待**，且可能抢焦点——这是用户可感知副作用，接入动作工具前必须解决或明示。

### 窗口标题不是身份（2026-10-10 修复）

首次前台打字后即失败并报 `window identity changed or is not visible`：记事本把窗口标题从「未标题 - Notepad」改成「Cua background typing check - Notepad」，而 adapter 把标题纳入了动作前的身份校验。**标题会随文档内容变化，打字本身就是改标题**，用它做身份等于第一次输入后必然自我锁死。

已修复：身份只由 `(pid, windowId)` 与可执行身份构成，标题不再参与动作前的比对。不安全标题仍由 `validateWindow` 在每次观察时拒绝。

## 截图经附件服务交付给模型（2026-10-10）

此前 `safe_win_observe` 硬拒绝 `screenshot: true`，理由是无法证明图片能被模型看到。现在打通，方式与 DSH 官方 `computer-use-cua-driver-mcp` 的组合测试一致：

- `src/screenshot-delivery.js` 通过 `ctx.get('attachments')` **按服务名**取宿主附件存储，因此**不需要 import 任何宿主包**，「不引入第二份 dsh-tools」的约束不受影响。
- 截图字节**绝不进入规范 JSON**：只有 `ImageAttachmentRef` 进入结果字段，字节由附件服务校验（完整解码光栅图）并规范化后存储。
- 图像块通过 `projectContent` 投影到内容里，与渲染文本并存。`src/tool-def.js` 新增了该钩子，与宿主同名钩子契约一致。
- 投影前会校验「结果值仍是执行时那个值」：若策略层改写了值，就保留渲染文本、不挂图，避免把截图贴到它并不描述的输出上。
- 组合中没有附件存储时，`screenshot: true` **fail closed**并给出明确原因；`screenshot: false` 完全不需要该服务。

官方组合测试的四条验收标准，本仓库已覆盖后三条（mock 附件服务）：工具结果里同时出现 text 与 image 块、引用可从附件服务读回、**base64 不出现在结果 JSON 中**。

**未验证**：真实 DSH 宿主中的端到端渲染（模型是否真的看到图）、多图批次、模型路由的图片能力协商。这需要把本仓库挂进用户的 DSH profile 实测。

### agent cursor 的可见副作用（2026-10-10）

SDK 提供 `SetAgentCursorEnabled` / `SetAgentCursorMotion` / `SetAgentCursorTheme` 一整套光标 API。本插件**未调用任何一项**，但 live 点击时屏幕上仍出现了蓝色 agent cursor：它是 `route: accessibility` 通路（UI Automation）的副产品，关闭它需要显式 `session`，而本插件的点击走隐式生命周期会话。

- 该光标是独立覆盖层，不替换也不干扰用户自己的系统指针。
- 用户明确表示保留显示：让自动化输入在屏幕上可见，好过悄悄移动别人的鼠标。
- 观察-only 模式不受影响——没有输入就没有光标。

因此这是**已知且被接受的用户可感知副作用**，不是待修缺陷。

输出截图前，须核实 DSH 工具运行时（`@deepseek-ai/dsh-tools`）的附件/图片管线并通过真实 Loader 输出测试。**附件管线已按官方组合测试的契约打通（见下），但真实宿主中的模型可见性尚未验证，因此仍不宣称截图已被模型看到。**

## 驱动安装的三个易错点（0.1.2 起修正）

「安装驱动」曾经对**任何人**都不可能成功，三个阻塞点各自独立：

1. **回环判定不能读 `request.url`。** DSH 的 Connection 网桥把每条路由请求构造在合成的
   `http://dsh.internal` 源上（见 `dsh-client-connection` 的 `bridge()`），其 hostname 恒为
   `dsh.internal`。真实 authority 在 `Host` 头里。必须读 `Host`。
2. **`ZipFile` 在 `System.IO.Compression.FileSystem`。** 只 `Add-Type -AssemblyName
   System.IO.Compression` 会让 `[System.IO.Compression.ZipFile]` 未解析（TypeNotFound）。
3. **`powershell -Command <script> <arg>...` 不绑定 `param()`。** 尾部参数会被丢弃，脚本拿到
   空路径。路径须经环境变量传递；脚本用 `-EncodedCommand`（UTF-16LE）传递，避免控制台代码页
   破坏脚本内容，也避免带空格或引号的路径改变命令文本。

官方压缩包还包含原生 SDK、鼠标指针主题与头文件共 6 个条目。布局检查只要求「至少含两个目标
可执行文件」，且只解出可执行文件：`.node`/`.dll` 已由 `@trycua/cua-driver` npm 依赖提供，
其余文件本插件从不加载，不应进入受管目录。SHA-256 与官方 `checksums.txt` 逐一核对一致。

界面注册在 `settings.section`（设置侧栏独立分区），与其他设置功能一致，而非
`plugins.bundle.config`（Plugins 页内的配置块）。

## 宿主服务依赖（0.1.6 起）

Host 半 `inject: ['connection', 'computerUse']`。当前 web profile 的 manifest 含 `dsh-computer-use-safe-win`，但其依赖中不含 `@deepseek-ai/dsh-computer-use`；配置也未在 `cordis.patch.yml` 显式列出 provider。该状态可解释 `pending (waiting for service: computerUse)`，但未检查运行中 Loader composition，故不能断言它是唯一原因。

- `connection` —— 认证 API 通道，路由挂载点。
- `computerUse` —— `@deepseek-ai/dsh-computer-use` 提供的**独占提供者注册表**，保证同一时刻只有一个 computer-use provider 控制桌面。**按服务名取用，不 import 宿主包**，因此不引入副本。
- `configForms` 是浏览器端 `ui-settings` 提供的服务，与 Host 的 `pending` 问题无关。`settings.section` 是根 Settings shell 渲染的子 slot，Shell 不会把注册插件的 Cordis `ctx` 或服务代理传给其 Component；若 Component 读取其未注入的 `configForms`，会触发 render error 并由 Renderer 的 entry error boundary 隔离该 section。客户端 `apply(ctx)` 可在声明 inject 中获取 form，然后通过闭包传给 Component。Host 仍必须排除 `configForms`。实际 GUI 空白是否由此触发，尚待认证后验证。

宿主半在 `enabled: false` 时也会挂载 provider，使启用/停用/白名单改动对下一次调用立即生效；代价是必须存在 `computerUse` 服务。profile 是否已装载该 provider 应通过当前 composition 状态确认。

**前置依赖的查询与安装一律由浏览器半完成**（`remote.pluginManager.listBundles()` / `installBundle()`），**不得**放在本插件的 Host 路由里：在前置包装好之前宿主半根本不会激活，它自己的路由无法应答「装没装」，会形成死锁（v0.1.6 的缺陷，`/requirements` 路由因此被删除）。同理，插件**绝不**直接改 profile 文件——`dependencies` 与 `bundles` 由插件管理器写，只走受管安装接口。

**浏览器半注册分区只用 `slots.register(options, component)` 重载**；附加数据（例如当前客户端上下文取得的 `configForms`、可选的 `pluginManager`）经闭包传入。`settings.section` 注册项没有 `inject` face，Shell 不会把 Provider 的服务注入子组件；Renderer 的标准注入包含 locale 的 `t`，而其余来自注册项自己的 `inject` 或父 slot 明确声明的共享 inject face。该插件捕获 `configForms` 后通过闭包传给 `DriverSettings`，且在无该服务时以不可用状态降级。旧版测试桩只检查 `register()` 参数形状，并未复现真实 Renderer 的子 slot props 装配，因此不能据此归因 v0.1.6 / v0.1.7 空白。

## 宿主依赖边界（0.1.1 起强制）

插件**不得**在运行时 import 任何 `@deepseek-ai/dsh-*` 宿主**运行时**包，也**不得**把这类包写进
`dependencies` / `optionalDependencies`。违反会引入 DSH 核心模块的第二份物理副本：
Profile 会多装一个 `@deepseek-ai/dsh-tools`，宿主与副本各自 `import` 的
`TOOL_RUNTIME_SCHEDULER` 是两个不同的 Symbol，`dsh-agent-loop` 读取
`ctx.tools[TOOL_RUNTIME_SCHEDULER]` 得到 `undefined`，抛出
`Cannot read properties of undefined (reading 'prepare')`。

**`@deepseek-ai/schemastery` 是例外且必须声明为依赖**（0.1.5 补上）。它是宿主自身也当作普通运行时依赖的纯校验库，不含任何 DSH 运行时 Symbol；不声明它会让安装后的插件无法解析该包而完全不可用。`test/host-dependency-isolation.test.js` 的三条隔离测试继续通过。

两条约束缺一不可：

1. `dependencies` 只放真正随插件分发的第三方库（当前仅 `@trycua/cua-driver`）。
2. 工具定义由 `src/tool-def.js` 自行构造，编译出的 `parameters` / `output.schema`
   已逐字节对齐 `defineTool()` 的投影，参数校验也自行保留——因此无需 import 宿主包。
   注意 `output.schema` 必须写**原生 JSON Schema**：宿主 DSL 的 `type: 'json'` 会被
   `defineTool` 编译成 `{}`，直接照抄 `'json'` 会被 `assertSupportedJsonSchema` 拒绝。

注意 `autoInstallPeers: false` 只对 **peerDependencies** 生效，因此「改成
peerDependencies 就没事」并不成立：宿主包一旦以任何可安装形态出现在 manifest 里，
都可能让 Profile 物化出独立副本。本插件采用更强的「完全不声明 + 不 import」。

`test/host-dependency-isolation.test.js` 以回归测试固化以上约束，新增宿主 import 或
新增宿主依赖都会使测试失败。

## 测试与发布

仅运行本仓库限定测试：`npm test`（`node --test test/*.test.js`）。**禁止裸 `node --test`**，因为忽略的 `OtherRepo` 含真实桌面自动化测试。

- `npm run pack:check`：tarball dry-run。
- `npm run verify:package`：scratch install、检查 tarball 无 helper、确认 patch/`./client`/locale/icon 资源完整，并通过真实 Loader 验证 observation-only 工具注册与卸载。
- 驱动安装的端到端路径（下载 → 校验 → 解压 → 落盘）已用真实官方压缩包在临时目录验证，
  受管目录只出现 `cua-driver.exe`、`cua-driver-uia.exe` 与 `release.sha256`，二次安装为幂等。

这些检查不启动 Cua worker，也不接触桌面。测试不能替代未验证的运行能力。

## 安装后引导与驱动管理

插件安装后只需一个包名 `dsh-computer-use-safe-win`：同一个 Loader 行同时挂载 Host 半与浏览器半（`dsh.client.platform: web` 声明使其进入浏览器模块表）。**不再声明单独的 `/client` 行**——子路径行会解析到同一包并在模块表中与包名行冲突。

Host 半常驻在认证 API 通道（`ctx.connection.fetch.register`，路径必须在 `/api` 下）上提供四条 exact 路由，由 Connection 的 Host/Origin 栅栏和浏览器认证先行裁决。`validate-config` 仅是 GUI 草稿预检，不保护 Settings Remote 的直接写入；配置 schema 与插件 `validateConfig` 导出负责拒绝非法配置，provider 在每次调用前再 fail closed。`running-apps` 供白名单选择器读取本机运行中的可执行程序：它会启动 worker 并枚举进程，因此与安装路由共用回环 + same-origin 栅栏，且只返回可执行身份、不读窗口标题。

- `GET /api/computer-use-safe-win/status`：只读受管目录，区分目标版本与已安装版本，并标记 `runtimeVerified: false`。
- `POST /api/computer-use-safe-win/install`：除认证外还要求回环请求地址、same-origin 标记与显式确认头；远程 Host 或跨源请求返回 403，同一时刻只允许一次安装。

安装器固定 `0.28.0` 官方发行包的 SHA-256，校验响应来源、体积上限、ZIP 根条目与解压总量，并在临时目录完成后原子重命名；从不执行二进制。浏览器半在 Settings 侧栏注册 `settings.section`，通过 Host `configForms` 显示 observation 设置。草稿先经 `/api/computer-use-safe-win/validate-config` 独立校验（最多 64 项、拒绝重复及危险/格式错误的名称、统一小写），再以 Host revision fence 原子持久化；禁用时允许空白名单，启用时必须非空。此设置变更不会绕过平台和驱动检查。安装不启动 worker、不枚举桌面；观察须另行启用并配置 `allowedApps`。

## 阶段

- A（版本/API/拓扑静态证据）：完成，见 STAGE-A.md；未运行 Cua。
- B（观察路径、身份校验、Loader 与生命周期）：已实现并有桌面无关测试；完整打包验证已通过。
- B.1（设置写入校验与多应用 GUI 往返）：schema 限定 exe 文件名和 64 项上限，Host `validateConfig` 与 apply 均检查危险项、重复项和启用/白名单约束；GUI 按真实换行显示多应用白名单。只完成桌面无关验证，不代表 Remote 权限策略或真实 UI 验收。
- B.2（快照完整性与投影边界）：把快照判定与边界投影抽到不依赖 Cua SDK 的 `src/snapshot-policy.js` 并加桌面无关测试，拒绝非目标窗口、degraded、静默不完整元素集、失效截图帧与越界 image。仍未验证真实 driver 行为与图像交付。
- B.3（调用串行化、放弃隔离与 drain）：把执行控制抽到不依赖 Cua SDK 的 `src/operation-queue.js`：超时/取消不再隐含「底层已停」的假设，被放弃的调用隔离 runtime，关闭前有界 drain。仍是观察-only，不代表已满足动作门禁。
- B.4（worker 启动选项固定）：把启动选项抽到 `src/driver-options.js` 并对着真实 SDK 断言整份记录。发现 SDK 的 record factory 完全不校验（见上），因此授权上限只能由该断言保证。测试仅 import SDK 载入库，不启动 worker、不调用任何 driver 方法。
- B.5（白名单路径项与运行中应用选择器）：白名单条目支持绝对路径且与文件名互不替代；设置侧栏改为逐条增删改，并可从 Host 读取本机运行中的可执行程序填入。live 实测发现驱动对 Store 版应用不上报 `launchPath`（490 个应用中 12 个缺失，含记事本），因此文件名项保留，路径项是可选的更严格形式。
- B.6（后台点击送达语义的 live 证据）：前台窗口与**非激活后台窗口**两次点击均报 `route: accessibility` / `delivery.mode: background` / `effect: unverifiable`，而窗口确实改变且未抢焦点。据此固化「后台语义是硬能力」「驱动自述不是效果证据、模糊结果不可重放」。
- B.7（文字输入的能力边界与标题身份修复）：实测 `typeText` / `pressKey` 在后台窗口下自述成功但字符数不变，前台则字符数客观递增（0→27→39→49）。同时修复「窗口标题被当作身份」导致首次输入后自我锁死的缺陷。动作工具仍未注册。
- B.8（截图经附件服务交付）：新增 `src/screenshot-delivery.js` 与 `defineTool` 的 `projectContent` 钩子，截图以 `ImageAttachmentRef` 进结果、图像块由投影并入内容，附件存储按服务名取得、不 import 宿主包，缺服务时 fail closed。真实宿主中的模型可见性仍未验证。
- C（输入动作、审批后重验、结果验证、截图附件）：未完成；动作关闭，图像管线未验证。
- D（移除旧 helper 链路、测试/配置/文档/打包）：旧产品代码与测试已移除；打包校验覆盖 client/locale/icon 资源。
- E（最终审阅与本地提交）：前序实现已有本地提交与 tag `mvp-0.1.0`；后续 GUI/配置修订按检查结果单独本地提交，不 push。

旧 .NET helper 测试及 live acceptance 不是 Cua 验收。用户留下的未跟踪 `scripts/verify-live-inspect.mjs` 仍引用旧 helper，按要求保持未修改、未提交且不可运行。本次未进行 live desktop run；未来 live run 需针对明确隔离 fixture/VM 另行审批。
