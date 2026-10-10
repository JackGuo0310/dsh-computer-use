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
- DSH 输出目前走 JSON/text 适配，不代表图像附件已被模型渲染或测试。截图选项目前拒绝 true；请勿依赖截图输出。
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

- 白名单按可执行文件名匹配，如 `notepad.exe`；不改为完整路径匹配。文件名不是签名认证。
- Cua 原生桌面运行时不能在 DSH host 内执行；版本与隔离路径先核实，再锁定一种实现。
- 模型只能调用本插件受控入口，不能直接访问上游全量工具。
- 每个状态改变动作需要一次明确用户批准；审批拒绝、缺失、取消或目标变化均拒绝执行。
- 后台输入拒绝不能自动回退前台；取消不能撤销已送出的输入；动作后重新观察不等于业务目标已验证。
- 未经用户针对具体运行批准，不枚举真实桌面、不截图、不发输入。live 验收仅在批准后的隔离 fixture/VM 中进行。

## 开发与交接

默认测试限定为本仓库 `test/*.test.js`；**禁止不带范围的 `node --test`**，因为忽略的第三方参考仓库含真实桌面自动化测试。

开发命令：`npm test` 仅运行仓库内 `test/*.test.js`；`npm run pack:check` 做 tarball dry-run；`npm run verify:package` 检查打包内容与依赖；`npm run verify:install` 把 tarball 装进临时目录后用真实 Loader 验证已安装副本（不注册工具、路由可应答、卸载后撤回）。以上均为桌面无关检查。不要运行不带范围的 `node --test`。

## 尚未验证

浏览器半的**真实渲染**仍需在运行中的 DSH Web GUI 验证。`test/client-bundle.test.js` 在 `node:vm` 中加载真实产物，模拟 DSH Renderer 传入的 `t(key)`，覆盖文案、状态读取、安装确认、错误呈现与侧栏分区；React 调和、slot 渲染器交互和实际点击未在此验证。安装后请在设置侧栏「电脑操控」确认状态和两个按钮。

实施按小阶段做本地 Git commit，不 push。保留既有用户改动，不通过重置工作树掩盖迁移。

## 安装（按 tag）

```sh
# 在 DSH 插件管理器 → 添加插件（公开仓库，无需 SSH key）
git+https://github.com/JackGuo0310/dsh-computer-use.git#v0.1.3
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

## 许可证

[MIT](<LICENSE>) License，Copyright (c) 2026 Jack Guo。
