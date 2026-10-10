# DSH Windows Computer Use

独立、按需启用的 DeepSeek Harness Windows computer-use 插件。

## 当前决策与实现状态

**2026-10-09 用户已批准全面切换 Cua Driver。** 运行时代码使用 `@trycua/cua-driver@0.28.0` SDK-managed private worker。因该版本背景语义点击的行为尚未验证，当前只开放 allowlist 窗口列举和单窗口观察；不暴露任何输入动作。无截图传输/渲染的验收结论，不宣称完整 Cua 功能已通过。旧 .NET UIA/Win32 helper 产品代码已移除，不保留双后端或自动回退。

- 完整迁移方案：[DESIGN.md](<DESIGN.md>)。
- 新会话可直接使用的实施提示词：[HANDOFF.md](<HANDOFF.md>)。
- 阶段 A 的版本/API 静态证据见 [STAGE-A.md](<STAGE-A.md>)。Cua SDK 已作为开发依赖安装以供静态测试；Driver 可执行文件未安装、worker 未运行，真实桌面、截图和输入均未触及。
- 当前安全边界是**观察-only**：只注册 `safe_win_list_windows` 与 `safe_win_observe`，且不向模型暴露 Cua element token。动作、审批后执行与结果验证尚未接入；不把上游能力写成本插件已通过的能力。
  - 快照的完整性判定与边界投影在 `src/snapshot-policy.js`，不 import Cua SDK，因此可桌面无关地测试：拒绝非目标窗口、degraded、静默不完整元素集和失效截图帧，并限制 element 数、文本长度与图像字节。显式 `truncated` 仍作为可见信息返回。
  - 调用串行化与取消语义在 `src/operation-queue.js`（同样不 import Cua SDK）：同一 runtime 一次只发一个 driver 调用；超时或取消只让调用方停止等待，worker 可能仍在执行，因此被放弃的调用会把 runtime 置为 quarantine 并拒绝后续调用，关闭时先在有界预算内 drain 再 shutdown，不自动重放。
  - worker 启动选项在 `src/driver-options.js`，由测试对着真实 SDK 断言整份记录。SDK 的 record factory 只做 `Object.freeze({...defaults(), ...partial})`、不做校验，所以「仅 Standard 权限模式、不确认 unrestricted、TTL 上限」这些授权上限只有断言在保证。该测试只加载 SDK，不启动 worker。
- `safe_win_observe` 的 `screenshot` 现在可用：截图经宿主附件服务存为 durable 引用，模型可看到图像块。图像字节不进入结果 JSON（按服务名取 `ctx.attachments`，不 import 宿主包）；组合中没有附件存储时 `screenshot: true` 会明确失败，`false` 不受影响。**真实宿主中的模型可见性尚未验证。**
- SDK 的 npm 包不含 `cua-driver.exe`；私有 worker 需要另行安装固定版本的 Windows release。插件安装后在 **设置侧栏** 出现一个「电脑操控 / Computer Use」分区（同一个包名同时挂载 Host 与浏览器两半），Host 常驻在认证 API 通道上注册 `/api/computer-use-safe-win/status` 与 `/api/computer-use-safe-win/install` 两条路由，该分区提供「测试驱动」与「安装驱动」两个按钮。
  - 「测试驱动」只读受管目录，返回目标版本、已安装版本与平台支持情况；版本来自固定 checksum 的官方发行包，**未启动驱动验证**，因此界面显示「受管驱动已安装（未启动验证）」。
  - 「安装驱动」需本机浏览器同源 POST：`Host` 头必须是回环地址（`127.0.0.1`、`localhost` 或 `[::1]`）、请求头标记 same-origin、且带显式确认头；远程 Host、跨源或缺少 `Host` 的请求返回 403，不会下载任何内容；同一时刻只允许一次安装。
    - 注意本地浏览器判定读的是 **`Host` 头**，不是 `request.url`：DSH 的 Connection 网桥把每条路由请求都构造在合成的 `http://dsh.internal` 源上，据此判定会永远失败。
  - 安装包为官方 `cua-driver-rs-<版本>-windows-<架构>-binary.zip`，按固定 SHA-256 校验后只解出 `cua-driver.exe` 与 `cua-driver-uia.exe`；随包的原生 SDK、鼠标指针主题与头文件不会装入受管目录（`.node`/`.dll` 已由 `@trycua/cua-driver` 依赖提供）。
  - 安装完成后需要另行把 `config.enabled` 置为 true 并配置 `allowedApps`，观察工具才会注册；安装本身不启动 worker、不枚举桌面。默认 patch 即 `enabled: false`。
- `enabled` 和 `allowedApps` 均通过 Host 的 volatile 配置表单写入；侧栏保存前由 Host 校验完整草稿，再使用当前 revision 原子提交；冲突或只读 profile 不会显示为保存成功，内存/只读 profile 或表单不可用时禁用写入。设置 schema 自身也限定 `.exe` 文件名格式与最多 64 项，Host `validateConfig` 和插件 `apply` 再拒绝危险/重复白名单及启用时空白名单；GUI 支持以换行分隔的多应用列表。独立 `/validate-config` 仅是 GUI 草稿预检，不是 Settings Remote 写入的授权栅栏。
  - 插件名称、说明与图标来自 `locale/*.json` 与 `icon.svg`，因此列表里显示为本地化标题而不是包名。
- 旧 Notepad 只读验收及 helper mock 测试属于旧后端，不是 Cua 验收结果。保留的未跟踪 `scripts/verify-live-inspect.mjs` 仍引用 helper，因用户要求不修改、不提交且不可运行。

## 不能放宽的约束

- 白名单每一项可以是可执行文件名或绝对路径：路径项只匹配该绝对路径（更精确），文件名项匹配可执行文件名（驱动未上报路径的应用仍可加入）。路径需绝对、指向 `.exe`、不含 `..`；受保护进程两种形式都拒绝。两种形式互不替代：路径项不会退化成文件名匹配。
  - 设置侧栏的白名单是逐条列表：每项一个输入框，可单条删除、点「添加应用」追加空行，也可以点「从运行中的应用选择」由 Host 列出本机正在运行的可执行程序（有路径的按绝对路径添加）。保存走 Host 的 revision 原子提交，保存后对后续调用立即生效，无需重启。
- Cua 原生桌面运行时不能在 DSH host 内执行；版本与隔离路径先核实，再锁定一种实现。
- 模型只能调用本插件受控入口，不能直接访问上游全量工具。
- 每个状态改变动作需要一次明确用户批准；审批拒绝、缺失、取消或目标变化均拒绝执行。
- 后台输入拒绝不能自动回退前台；取消不能撤销已送出的输入；动作后重新观察不等于业务目标已验证。
- 未经用户针对具体运行批准，不枚举真实桌面、不截图、不发输入。live 验收仅在批准后的隔离 fixture/VM 中进行。

## 开发与交接

默认测试限定为本仓库 `test/*.test.js`；**禁止不带范围的 `node --test`**，因为忽略的第三方参考仓库含真实桌面自动化测试。

- 开发命令：`npm test` 仅运行仓库内 `test/*.test.js`；`npm run pack:check` 做 tarball dry-run；`npm run verify:package` 检查打包内容与依赖；`npm run verify:install` 把 tarball 装进临时目录后用真实 Loader 验证已安装副本（不注册工具、路由可应答、卸载后撤回）。以上均为桌面无关检查。`test/driver-options.test.js` 会 import `@trycua/cua-driver` 载入库本身（只加载原生库，不调用任何 driver 方法、不启动 worker）。不要运行不带范围的 `node --test`。

## 尚未验证

已确认 Renderer 的 props 规则：`settings.section` 是 shell 渲染的子 slot，不会继承插件 `apply(ctx)` 的 Cordis 服务代理，因此 `configForms` 与 `remote.pluginManager` 都由 `apply(ctx)` 取得或动态接管后经闭包传入。0.1.10–0.1.13 的分区渲染已在**认证后的真实 GUI** 中逐版目视确认：分区可见、驱动状态与按钮行为正常、DSH 原生化样式生效、挂载步骤与版本解析（`0.2.1-alpha.1` → `@0.2.1-alpha.2`）正确显示。

`computerUse` 不再是必需依赖：DSH 默认 web profile 不挂载该注册表，Host 插件管理器也只激活带 bundle patch 的包（`installBundle` 会回滚无 patch 的包），因此没有任何自动安装路径。0.1.10 起 Host 半在缺少注册表时照常挂载两个观察工具，并在服务出现时取得独占槽位。**注册表本身尚未在本机挂载**，因此「挂载后自动取得独占槽位」这条路径仍未实测。

`test/client-bundle.test.js` 仍加载真实插件 `client.js`，但使用轻量 React/slot harness，不等同于真实 DSH Renderer 或 React 调和；已覆盖 `configForms` 缺失、`remote.pluginManager` 延迟挂载、404 文本响应、挂载步骤渲染与剪贴板、按钮可用性。真实 GUI 中的可见渲染与交互已由上述目视确认补充，但仍无自动化覆盖。

实施按小阶段做本地 Git commit，不 push。保留既有用户改动，不通过重置工作树掩盖迁移。

## 安装（按 tag）

```sh
# 在 DSH 插件管理器 → 添加插件（公开仓库，无需 SSH key）
git+https://github.com/JackGuo0310/dsh-computer-use.git#v0.1.14
```

安装后在设置侧栏打开「电脑操控 / Computer Use」分区，先「刷新驱动状态」确认状态，再按需「安装驱动」。启用观察还需在插件配置里写入 `allowedApps` 并把 `enabled` 置为 `true`。独占注册表 `@deepseek-ai/dsh-computer-use` 是可选的，挂载方法见 0.1.10 一节。

### 0.1.0 → 0.1.1（重复核心模块）

0.1.0 把宿主的 `@deepseek-ai/dsh-tools` 声明为普通 `dependencies`。安装它会让 DSH Profile 在
`~/.dsh/profiles/<profile>/node_modules/` 下**再装一份 DSH 核心工具运行时**。宿主与副本各自
`import` 出的 `TOOL_RUNTIME_SCHEDULER` 是两个不同的 Symbol，等于同一对象上出现两个键，
`dsh-agent-loop` 随即抛出 `Cannot read properties of undefined (reading 'prepare')`。

**卸载 0.1.0 不会自动清掉那份残留副本**（取决于当时的安装状态），因此升级后请确认一次：

```sh
# 先退出 DSH，再确认 Profile 下已没有独立的 dsh-tools
ls ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools
```

- **目录已消失**（pnpm 的正常情况）：无需处理，重启 DSH 即可。
- **目录仍存在**：删掉这一份即可，让解析回落到全局 DSH 的那份，然后重启 DSH。

```sh
rm -rf ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-tools
```

只删 `dsh-tools` 这一个目录。`cosmokit`、`schemastery` 等可能仍被 `dsh-remote`、
`dsh-better-sidebar` 共用，删掉它们反而会破坏其他插件。

> 如果你现在用 Windows Junction 把 Profile 的 `dsh-tools` 指向全局 DSH 来临时绕过 0.1.0，
> 装上 0.1.1 后可以撤掉：确认目录已不存在即说明回落正常。**在确认之前请保留该 Junction**，
> 它是你当前 DSH 正常工作的前提。

0.1.1 自身不再引入任何宿主包，工具定义由 `src/tool-def.js` 自行构造，只依赖注入的 `ctx` 服务。

### 0.1.1 → 0.1.2（驱动装不上 + 界面位置）

0.1.1 的「安装驱动」**对任何人都装不上**，有三个各自独立的阻塞点：

1. 本机浏览器判定读了 `request.url` 的主机名，而 DSH 网桥把每条路由请求都构造在合成的
   `http://dsh.internal` 上，于是回环判定永远不成立，一律 403。现改读 `Host` 头。
2. 解压脚本只加载 `System.IO.Compression`，而 `[System.IO.Compression.ZipFile]` 实际定义在
   `System.IO.Compression.FileSystem`，每次都 `TypeNotFound`。现已加载正确的程序集。
3. `powershell -Command <script> <arg>...` **不会**把尾部参数绑定到脚本的 `param()` 块，
   两个路径都被丢弃，解压因「路径非法」失败。现改为经环境变量传参并用 `-EncodedCommand` 传递脚本。

同时把官方压缩包的布局检查从「必须恰好 2 个条目」放宽为「至少包含两个可执行文件」，
并只解出驱动可执行文件（随包的 `.node`/`.dll` 已由 npm 依赖提供）。界面从 Plugins 页内的
配置块改为设置侧栏的独立分区。

迁移无需任何手动步骤，升级即可。

### 0.1.2 → 0.1.3（设置面板文案）

DSH Renderer 给 `settings.section` 的 `t` 是翻译函数 `t(key)`，不是字典对象。
0.1.2 把它当 `t.title` 等属性读取，造成标题、按钮消失以及状态显示 `undefined`。
0.1.3 改为调用翻译函数，并让回归测试模拟真实 Renderer 接口。

### 0.1.3 → 0.1.4（截图可见、输入能力、配置实时生效）

这一版把观察能力补齐，并用实测修掉了几个让观察**从来无法工作**的缺陷。

**升级后必须重做一次**：打开设置侧栏「电脑操控」，重新勾选「启用窗口观察」并保存白名单。旧配置里的白名单条目格式未变，但插件会在启动时校验一次配置，校验不通过就不注册工具。

已修复（升级前观察功能实际不可用）：

1. **窗口列举永远返回空**。adapter 用一个转义写错的正则校验可执行文件名，字符类实际只接受 `` \ w . - ``，任何真实应用都被过滤掉。
2. **Store 版应用漏掉**。驱动对记事本这类应用不上报 `launchPath`，现在按 `name` 兜底；两者矛盾时拒绝而不是二选一。
3. **驱动 worker 从未能启动**。启动选项字段名写错（`key` 应为 `name`），且 `RUST_LOG` 不在 worker 的环境变量白名单内。
4. **禁用观察时反而启用**。`volatile` 配置字段在运行时是一个恒为真的句柄，直接判断会把它当成已启用。

新增能力：

- **`safe_win_observe` 的 `screenshot` 可用**。截图经宿主附件服务存为 durable 引用，模型能看到图像块；图像字节不进入结果 JSON。没有附件服务的组合里请求截图会明确失败，`screenshot: false` 不受影响。
- **打字与按键**（`src/cua-adapter.js` 的 `typeText` / `pressKey`）。**模型目前还用不到**——插件未注册任何动作工具，动作仍需逐次审批的设计尚未接入。
- **白名单支持绝对路径**。每项可以是可执行文件名或绝对路径（如 `C:\Program Files\App\app.exe`），路径项只匹配该路径，文件名项只匹配文件名，两者互不替代。设置侧栏改为逐条增删，并可从本机运行中的应用里选择。
- **配置保存立即生效**。设置字段是 volatile 的，宿主原地更新不重启插件，因此插件每次调用现读配置；worker 也改为首次使用时才启动。

已知限制：

- **文字输入需要窗口有焦点**。实测后台输入驱动自述成功但字符数不变；前台则正常。点击不受此限制，可纯后台执行。
- 自动化输入会在屏幕上显示一个蓝色 agent cursor（驱动的 UIA 通路副产品），这是可见且被接受的副作用。
- 动作工具仍未注册：需要一次性审批与审批后重验链路，且取消/失败路径尚未实测。

### 0.1.4 → 0.1.5（修正宿主服务声明）

v0.1.4 曾被报告启动挂起、设置面板空白。发布代码包含错误的宿主依赖声明；它能解释 Host half 对 `configForms` 的等待，但不单独证明当时设置页空白原因：

1. **`configForms` 不应由 Host half inject**。它是 `@deepseek-ai/dsh-ui-settings` 提供的浏览器端服务，Host composition 中不可用；Host 保留它会令插件等待永远无法满足的服务。
2. **`computerUse` 缺失**。v0.1.3 在 `enabled: false` 时提前返回，因此未访问此服务；改为禁用时也挂载 provider 后，注册表成为必需依赖。

该版本之后 `computerUse` 仍未随插件一同安装，因而 pending 状态曾继续出现；相关运行时 profile 状态需另行诊断。

同时修复两个只有安装后才会暴露的问题：

3. **`@deepseek-ai/schemastery` 没有声明为依赖**。`src/settings-validation.js` 需要它，但安装后的插件无法解析（`Cannot find package`）。它是宿主自身也当作普通运行时依赖的校验库，不含 DSH 运行时 Symbol，因此不违反「不引入宿主运行时包」的约束（三条隔离测试仍通过）。
4. **`verify:install` 的清理会掩盖真实失败**。原生 addon 载入后 Windows 拒绝 unlink，`finally` 里的 `rm` 抛错会顶替掉真正的错误信息——正是它掩盖了上面第 3 条。

**升级**：把插件地址改成 `#v0.1.6`，然后重新启用观察并保存一次白名单。

### 0.1.5 → 0.1.6（尝试一键安装前置依赖）

v0.1.5 修正 `configForms` 的 Host 注入声明后，Host half 仍声明需要 `@deepseek-ai/dsh-computer-use` 提供的独占注册表；profile 没有该包时，插件停在 `pending (waiting for service: computerUse)`，路由不注册、工具不挂载。

当时设想的解决方式是由设置面板调用插件管理器安装该前置包，但这条路径**不成立**（见 0.1.10）：Host 插件管理器只接受带 bundle patch 的包，安装后会回滚；该包没有 patch，因此插件管理器无法安装它。

### 0.1.6 → 0.1.7（前置依赖查询移到浏览器半）

v0.1.6 的安装按钮走的是**本插件自己的 Host 路由**，于是形成死锁：宿主半要等 `computerUse` 服务才激活，而宿主半激活了才能回答「装没装」。本版把查询与安装移到浏览器半（`remote.pluginManager.listBundles()` / `installBundle()`），并删除 Host 侧的 `/requirements` 路由。

该版本仍假设插件管理器能安装这个包；0.1.10 用真实源码证明它不能，并取消了这个前提。

### 0.1.7 → 0.1.8（修正设置分区数据传递）

旧版 `settings.section` Component 直接读取 `configForms`，但该子 slot 不会收到注册插件 `apply(ctx)` 的 Cordis 服务代理。真实 Renderer 的源码表明，这类 render error 会被 entry error boundary 隔离；目前尚未在认证后的 GUI 复现或确认旧版实际错误。此前测试也只检查了 `register()` 参数形式，不能证明真实 slot 渲染。

本版在 `apply(ctx)` 捕获配置表单与可选插件管理器，再通过闭包传入 Component：

```js
const configForms = ctx.configForms
const Section = props => h(DriverSettings, { ...props, configForms, pluginManager: manager })
ctx.slots.inject('settings.section', () => ctx.slots.register({ … }, Section))
```

回归测试加载真实 `client.js`，并验证缺少 `configForms` 时分区内容仍可渲染；该测试使用轻量 React/slot harness，不覆盖真实 Renderer 和 React 调和。

### 0.1.9 → 0.1.10（Host 半不再等待独占注册表；驱动状态不再误导）

v0.1.9 之后仍有两个真实缺陷：

1. **Host 半永远 pending**。宿主 composition 里没有 `computerUse` 服务：DSH 默认 web profile 不挂载提供它的包，而 Host 插件管理器只激活带 bundle patch 的包（`installBundle` 对没有 patch 的包会回滚 `package.json`/`pnpm-lock.yaml`），所以**没有任何 profile 能替本插件装上它**。因此 `computerUse` 改为可选：缺少时插件照常挂载两个观察工具；服务出现时（包括之后热加载出现）立即用 `ctx.inject(['computerUse'])` 取得独占槽位。独占语义不变，只是不再以「等待一个永远不来的服务」为代价。
2. **驱动状态与按钮误导**。Host 半未激活时 `/status` 返回 404 文本，面板既显示原始 `Unexpected token 'o', "not found" is not valid JSON`，又把「安装驱动」显示为可点。现在：状态未知时明确显示「驱动状态未知（Host 半未激活）」，「安装驱动」只在状态证实**未安装**时可点；404 或非 JSON 响应统一转成可读原因。
3. **前置提示按钮失效**。`remote.pluginManager` 是 Remote namespace，客户端连接后才作为独立 Cordis 插件挂载；`apply` 期间读取只会得到 `undefined`（这正是「安装前置组件」按钮从未出现的原因）。现在改为 `ctx.inject(['remote.pluginManager'])` 动态接管，面板据此显示注册表状态。

注册表现在是**可选**的：面板只在能确认「未挂载」时给出说明与两条可复制步骤（0.1.12 起版本按当前 DSH 解析，见下一节），不再提供注定被拒绝的安装按钮。若需要严格互斥（例如同时使用官方 Cua provider），按面板给出的命令执行；不想挂载就忽略。

**升级步骤**：把插件地址改成 `#v0.1.10` → 浏览器硬刷新 → 重启 DSH → 打开「电脑操控」。此时应看到 `未安装 · 目标版本: 0.28.0`（若驱动已装则显示「受管驱动已安装（未启动验证）」），并可直接配置白名单。

### 0.1.10 → 0.1.11（设置分区改用 DSH 原生卡片风格）

面板原先用内联样式拼装（h4 + 原生 checkbox + 裸按钮），和 DSH 其它设置页不一致。本版改成与 `dsh-better-sidebar`「侧边卡片」相同的设置配方，全部沿用 shell 的设计令牌：

- 一行分区说明 + 包名/版本徽标（`dsh-computer-use-safe-win` `v0.1.11`）
- 分组卡片：`--dsw-alias-border-l2` 细线 + 16px 圆角 + `--dsw-alias-bg-layer-3` 填充，组标题 13/600
- 行配方：左侧「标题 14px + 灰色描述 12px」，右侧控件，行间细线分隔（末行去掉）
- 开关：真实 checkbox 驱动 36×20 track + 14px thumb（保留原生语义与键盘焦点）
- 按钮：8px 圆角、细线边框；主操作（安装驱动、保存配置）用 primary 填充

样式随模块注入一次（`document` 不存在时静默跳过），类名统一 `cu-` 前缀，避免与 shell 或其它插件冲突。测试断言样式只使用 `--dsw-*` 令牌、只注入一次、面板结构为「分组卡片 + 行 + 开关」，并校验 `client.js` 的版本号与 `package.json` 一致。

**升级步骤**：改地址为 `#v0.1.11` → 浏览器硬刷新 → 打开「电脑操控」即可看到新样式（客户端半热加载即可，无需重启 DSH）。

### 0.1.11 → 0.1.12（挂载注册表的两步给出可复制文本，版本不写死）

面板在确认注册表未挂载时，直接给出两条可复制的步骤（各有「复制」按钮）：

1. 安装包的命令：`dsh plugin --profile <当前 profile> add @deepseek-ai/dsh-computer-use@<版本>`
2. 需要粘进 `cordis.patch.yml` 的那条 insert

**为什么不做成一键安装**：DSH 的 Host 插件管理器只激活带 bundle patch 的包，`installBundle` 会把无 patch 的安装回滚；而插件本身**不得**写 profile 的文件（`dependencies`/`bundles`/patch 层都由插件管理器或用户掌握）。所以正确的做法是给出准确命令，由用户执行。

**版本不写死**：Host 半从运行中的 Harness 入口脚本向上找到 `@deepseek-ai/dsh` 的 manifest 读出真实版本（例如 `0.2.1-alpha.1`），再去 npm 取该包的已发布版本，**优先选与运行版本完全相同的那个**（0.1.14 起；见下一节说明为什么不能取同版本线的更新构建）。npm 不可达时命令退化为不带版本号的 `@deepseek-ai/dsh-computer-use`，不会凭空编造版本。命令里的 profile 名与配置文件路径来自 `DSH_PROFILE`/`DSH_PROFILE_DIR`，因此不同 profile 直接可用。

**升级步骤**：改地址为 `#v0.1.12` → 浏览器硬刷新。若确实需要严格互斥，按面板给出的两条命令执行；不需要就忽略这张卡片。

### 0.1.12 → 0.1.13（挂载步骤读取失败不再静默）

0.1.12 在 `/registry-setup` 请求失败时什么都不显示——看起来就像「卡片里没有命令」，无法判断是 Host 半过期还是别的错误。本版把失败原因显式显示在卡片里，并附一条通用的可复制命令（profile 名处为占位符），因此即使 Host 半还没加载到新路由，用户也仍然拿到可用指令。

**升级步骤**：改地址为 `#v0.1.13` → 浏览器硬刷新。若卡片里出现「无法读取挂载步骤: …」，说明 Host 半仍是旧代码，再重启一次 DSH。

### 0.1.13 → 0.1.14（注册表版本必须与 DSH 完全同版本）

0.1.12/0.1.13 选的是「同 core 版本线里最新的构建」，这在 DSH 这套版本体系里是**错的**：注册表包把自己的构建与 `@deepseek-ai/dsh-brand` 锁成同版本——

| 注册表包 | 要求的 `dsh-brand` | 本机 DSH `0.2.1-alpha.1` 自带的 brand |
| --- | --- | --- |
| `0.2.1-alpha.1` | `0.2.1-alpha.1` | `0.2.1-alpha.1` ✅ |
| `0.2.1-alpha.2` | `0.2.1-alpha.2` | 不匹配 ❌（pnpm 会再装一份 brand） |

所以现在**优先选与运行 DSH 完全相同的版本**；只有当该版本没有发布时，才退回到同版本线里最新的构建，并且面板会明确提示「未发布与当前 DSH 完全同版本的构建，这里取同版本线最新；它可能要求不同的 dsh-brand」。

**升级步骤**：改地址为 `#v0.1.14` → 浏览器硬刷新。卡片里的命令应变成 `…@0.2.1-alpha.1`（与你的 DSH 一致）。

## 许可证

[MIT](<LICENSE>) License，Copyright (c) 2026 Jack Guo。
