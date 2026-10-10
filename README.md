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

浏览器半的**真实渲染**仍需在运行中的 DSH Web GUI 验证。`test/client-bundle.test.js` 在 `node:vm` 中加载真实产物，模拟 DSH Renderer 传入的 `t(key)`，覆盖文案、状态读取、安装确认、错误呈现与侧栏分区；React 调和、slot 渲染器交互和实际点击未在此验证。安装后请在设置侧栏「电脑操控」确认状态和两个按钮。

实施按小阶段做本地 Git commit，不 push。保留既有用户改动，不通过重置工作树掩盖迁移。

## 安装（按 tag）

```sh
# 在 DSH 插件管理器 → 添加插件（公开仓库，无需 SSH key）
git+https://github.com/JackGuo0310/dsh-computer-use.git#v0.1.5
```

安装后在设置侧栏打开「电脑操控 / Computer Use」分区，先「测试驱动」确认状态，再按需「安装驱动」。启用观察还需在插件配置里写入 `allowedApps` 并把 `enabled` 置为 `true`。

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

### 0.1.4 → 0.1.5（v0.1.4 装不起来的热修复）

v0.1.4 发布后在真实 DSH 里启动即挂起、设置面板空白。根因有两个，都是发布前检查没覆盖到：

1. **`configForms` 被错误地声明为宿主依赖**。它是 `@deepseek-ai/dsh-ui-settings` 提供的**浏览器端**服务，宿主进程里永远不存在，插件因此一直 `pending (waiting for service: configForms)`，路由不注册、工具不挂载。
2. **`computerUse` 缺失**。v0.1.3 在 `enabled: false` 时会提前返回，因此从没读过这个服务；改成「禁用时也挂载 provider」以支持配置实时生效后，它必须出现在注入列表里。

同时修复两个只有安装后才会暴露的问题：

3. **`@deepseek-ai/schemastery` 没有声明为依赖**。`src/settings-validation.js` 需要它，但安装后的插件无法解析（`Cannot find package`）。它是宿主自身也当作普通运行时依赖的校验库，不含 DSH 运行时 Symbol，因此不违反「不引入宿主运行时包」的约束（三条隔离测试仍通过）。
4. **`verify:install` 的清理会掩盖真实失败**。原生 addon 载入后 Windows 拒绝 unlink，`finally` 里的 `rm` 抛错会顶替掉真正的错误信息——正是它掩盖了上面第 3 条。

**升级**：把插件地址改成 `#v0.1.5`，然后重新启用观察并保存一次白名单。

## 许可证

[MIT](<LICENSE>) License，Copyright (c) 2026 Jack Guo。
