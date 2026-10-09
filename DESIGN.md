# Cua Driver 全面迁移方案

决策日期：2026-10-09。用户已批准全面改用 Cua Driver，并停止旧方案的执行。本文件取代此前自研 .NET 8 UIA/Win32 helper 方案；后续会话应实施迁移，不再补完旧 helper。当前会话只更新文档，运行代码尚未迁移。

## 1. 决策与目标

- 桌面发现、可访问性读取、窗口截图和输入全部交给 **Cua Driver**。不是引入 Cua Agent 的另一套模型循环，也不是要求 Cua Sandbox 云服务。
- 保留本项目独立 DSH 插件的安装方式、配置、工具执行入口、审批与观察绑定。插件是带约束的 Cua provider，不是把上游所有工具直接转发给模型。
- Cua 的桌面运行时必须在 DSH host 之外的受管子进程中。禁止在 DSH host 内调用 `CuaDriver.create()` 执行原生桌面工作。
- 最终只有 Cua 一个桌面后端。删除旧 helper 的源码、运行依赖、协议、专用测试、打包命令和实时验收入口；不保留 `legacy` 模式、双后端开关或失败后自动回退。
- Windows 是本次目标。Cua 支持其他平台不代表本插件已验证跨平台能力。

之前以“DSH Cua 封装 experimental”及“上游没有我们的护栏”为由排除 Cua，理由不足：封装稳定性不等于驱动能力；本项目护栏应由自己的执行入口实现。但现有资料不足以断言 Cua 在所有 Windows 应用中生产可靠，仍须按实际版本和目标应用验收。

## 2. 当前基线与迁移边界

本次检查时 HEAD 为 `91d7542`。旧后端已经实施，不是待实现的空项目：

| 部件 | 当前状态 | 迁移处理 |
| --- | --- | --- |
| [plugin.js](<src/plugin.js>) | 三个 `safe_win_*` 工具；注册 `safe-win`；启动 dotnet helper | 改为 Cua provider、发现/观察/受控动作和图像输出 |
| [helper-client.js](<src/helper-client.js>) | 自研 JSON-lines helper 客户端 | 删除，由 Cua SDK/受管进程适配器替代 |
| [policy.js](<src/policy.js>) | 文件名白名单、按调用者观察、每个动作一次审批 | 保留约束意图；按 Cua 身份、token、快照和动作重写，不机械复用旧协议 |
| `native/` | .NET 桌面 helper 与其 C# 协议测试 | 从源码、构建和发布包中移除 |
| `fixture/` | 独立 Windows 测试应用 | 可保留为验收 fixture；不得成为产品桌面后端或安装依赖 |
| `test/` | helper mock、协议与 DSH 集成测试 | 协议测试替换；保留并迁移配置、审批、Loader、取消和卸载行为测试 |
| [acceptance.mjs](<scripts/acceptance.mjs>) | 绕插件直接调用旧 helper 的实时入口 | 改写为经过同一执行护栏的显式 opt-in fixture 验收 |
| [verify-package.mjs](<scripts/verify-package.mjs>) | 检查发布包携带 .NET helper | 改为验证 Cua 运行路径、插件安装及无旧运行时 |
| [package.json](<package.json>)、[锁文件](<package-lock.json>)、[bundle patch](<cordis.patch.yml>) | .NET prepack 与旧配置 | 同步依赖、版本、配置、打包及发布内容 |

工作树还存在未跟踪的 [verify-live-inspect.mjs](<scripts/verify-live-inspect.mjs>)。它不属于本次文档提交；新会话先读取、确认用途，不能把用户遗留改动当垃圾删除或顺带提交。

旧文档记录了 Notepad 的只读验收，未验证真实动作。这些结果仅属于旧后端，不计入 Cua 验收；不重跑旧 live acceptance。

## 3. 运行拓扑与版本门禁

目标拓扑：

```text
DSH tools / approval / attachment / computerUse
              |
本项目 Cua provider：白名单、调用者身份、观察、审批、串行执行、结果适配
              |
内部 driver adapter（不注册原始 Cua 工具给模型）
              |
受管独立进程中的 Cua Driver
              |
Windows 桌面
```

### 3.1 第一阶段确定唯一隔离路径

上游当前文档列出 `CuaDriver.createPrivateWorker(options)`：由 SDK 管理子运行时，通过继承管道通信，没有可重连公共端点。本地 DSH native 封装锁定 `@trycua/cua-driver@0.28.0`，但它使用同进程 `create()`；**不能据此认定 0.28.0 已支持 private worker**。

实施会话必须先核实选定版本的 npm 类型、Windows 原生包、匹配 executable、API 和进程模型：

1. 优先采用该版本官方、Windows 可用的 private worker，使用 SDK 自带监督与关闭能力；确认 host 是否仍加载原生绑定以及 host/worker 崩溃隔离的实际范围，不能只凭方法名宣布完全隔离。
2. 若选定版本不存在可用 private worker，采用本插件自有的薄 Node 子进程，在子进程内部加载官方 Cua SDK。该进程只负责适配与通信，**不得自研 UIA/Win32 桌面操作**。优先使用现有维护中的进程/协议设施；确需私有协议时验证两端输入、限额、超时及 teardown。
3. 第一阶段选定并记录一种路径，后续仅实现这一种；不做运行时自动降级。没有能验证的隔离路径就报告具体缺口，不能改用 host 同进程运行来交差。

官方独立 MCP 应用也是隔离方式，但本次不默认依赖共享 daemon：共享端点、其他连接和工具自动注册可能绕开本项目的执行流程。只有确认进程所有权、调用路径与关闭行为均满足本方案，才可经明确说明替换上述传输选择。安装现有 DSH native/MCP provider 并直接暴露全目录，不构成本次迁移完成。

### 3.2 部署要求

- 锁定经过验证的 SDK 版本；如需 executable，锁定匹配版本并校验兼容性，不使用浮动 `latest`。
- 需要用户安装 executable 时，提供明确 Windows 安装与路径配置；缺失/不匹配在加载时失败，不静默下载、安装或提权。
- 配置部署相关超时、限额和可执行文件位置；参数直接传递，不拼接 shell 命令。
- 启动只做必要握手、元数据和目录检查，不枚举桌面、不截图、不请求 OS 权限、不发输入。
- 子进程隔离是故障与生命周期隔离，不是 OS 安全沙箱。它仍具有启动账户的桌面权限；不承诺防御本机恶意进程或管理员。

## 4. 执行约束

### 4.1 应用与窗口身份

- `allowedApps` 必填、非空，以大小写不敏感的可执行**文件名**匹配，如 `notepad.exe`。用户明确拒绝改为完整规范化路径白名单；不要借迁移升级为路径匹配。
- 文件名白名单不是签名或可信二进制认证，同名可执行文件可通过。标题关键词也不是完整风险识别。
- 由实际运行进程身份取得文件名，不能用模型输入或应用 display name 冒充。先核实 Cua 返回字段；若需要补充身份解析，只允许最小的只读进程身份查询，不能借此重建原生桌面后端。无法确认则拒绝目标。
- 先发现允许的应用/窗口，再选择唯一目标；不能要求模型猜 HWND，也不能把整桌面截图作为默认观察。
- 每次观察和动作绑定当前进程身份、窗口 ID、调用者与 driver 生命周期。按上游字段类型保存 ID；避免 bigint 转 number 的精度损失。
- 禁止终端、密码/登录流程、安全设置、DSH 自身和提权目标。白名单中应用的弹窗也须重新校验。未知或无法可靠约束的目标拒绝。
- 关键词仅用于保守拦截常见危险表面，不能宣称它能完整识别删除、支付或安装。模型不能通过 `risk`、`approved` 或其他字段解除限制。

### 4.2 观察与执行

- 用 Cua 当前窗口快照读取可访问性和可选窗口截图。优先使用上游 `element_token`，不得把旧 helper 索引直接转成 Cua token。
- 每个调用者单独维护最新观察；观察含有效期、窗口身份、driver generation、可用目标和必要截图几何信息。其他窗口快照或同窗口重新采集可能影响上游 token，须按实际版本语义处理。
- 状态变化、超时、取消、断连、崩溃或身份不匹配后失效；进入动作流程即消费观察，模糊失败不得重放。
- 对共享 driver 的观察/审批/动作采用明确串行或租约管理，避免另一个会话重采快照使待审批 token 失效。排队动作在执行时重新校验，不能拿入队时校验当授权。
- 审批后重新检查窗口、进程、观察和目标。如重新采快照会使旧 token 失效，必须重新解析确切意图并验证等价；有歧义或实质变化就重新观察/审批，而不是拿旧 token 继续点。
- TOCTOU 无法完全消除：其他程序或用户仍可改变桌面。只报告能够验证的约束，不宣传窗口锁定或事务性输入。

### 4.3 输入与审批

- 本次迁移沿用当前更保守的规则：**每个状态改变动作都请求一次 DSH 用户批准**，不悄悄放宽为“只有危险动作批准”。拒绝、无 answerer、超时和取消均不调用 driver 动作。
- 审批描述目标应用、窗口、控件或截图位置、动作和影响。登录、密码、OTP 等禁止流程不是审批后即可开放的目标；敏感值不进入普通日志或审批文本。
- 目标能力包括 Cua 可验证支持的语义点击、受限文本输入、滚动和按键；截图坐标仅限最新目标窗口截图，并有边界、几何与身份校验。先逐项建立约束和测试，再开放对应工具；支持不了的具体动作应明确拒绝，不能留成静默 no-op。
- 文本输入不得到密码或未知焦点；先核验目标字段/焦点。无法约束到当前窗口的快捷键、全局输入、启动程序、shell/code execution、权限修改与任意桌面操作不暴露。
- 默认后台 delivery；驱动或应用拒绝后台输入时直接报告，不自动改前台，不承诺所有应用均后台可用。前台模式不在本次默认范围。
- 用 SDK/执行器强制这些约束，不只写提示词；adapter 接口不提供可从模型调用的原始 `callTool(name, arbitraryArgs)` 旁路。

### 4.4 结果与验证

- 动作后重新采集目标窗口状态。区分 `input delivered`、`outcome verified`、`verification failed/unknown`；不能将一次点击返回成功描述为任务完成。
- 记录审批、执行和验证的真实结果；测试无法证明业务目标时明确报告，而不是用 UI 状态任意变化充当目标实现。
- 图像通过 DSH attachment 与现有 MCP result adapter 或等价受支持链路进入模型，保持 text/image 顺序、持久引用、格式和整体大小限制。不要把 base64 塞进文本历史。
- 模型不支持图像时返回清晰诊断，不假称已看图；坐标动作无有效视觉证据时拒绝。
- 页面/窗口内容始终是非可信数据，不构成用户授权。取消不能撤销已经发出的输入。

## 5. DSH 工具与生命周期

当前集成参考使用 `ctx.computerUse.register(name)`、`ctx.tools.register(...)` 与 `ctx.systemPrompt.section(...)`；审批通过 `ctx.get('approval')?.request({ agent, toolName, callId, reason, signal })`，仅 `allowed-once` 放行一次动作。实施时按实际安装 DSH 版本核实这些 API，并保留审批的 Agent/turn 上下文；不能用脚本中的自定义确认代替产品审批流程。

- 继续作为独立可安装插件，通过 bundle patch 和配置管理接入；除非验证出必要缺口，不修改 DSH 核心或 GUI，不直接改 `OtherRepo/` 参考仓库。
- 建议保留 `safe_win_*` 命名族，调整为“发现窗口、观察、受控动作”的完整闭环；旧 HWND/索引/Invoke 参数协议不是必须保留的兼容 API。最终 schema 在第一阶段随版本证据定稿并写升级说明。
- 不保留旧 helper 的工具实现。不要同时启用本 provider 和官方 native/MCP provider；DSH 的 `computerUse.register` 只有一个 provider 槽位。
- 预留槽位后再启动 runtime；工具、指导和图像适配注册均有 disposer。任一启动失败回滚所有本插件资源。
- 所有真实 driver 动作仅走同一受控执行入口，工具、脚本和内部调用都不能绕过。原始上游目录可内部检查，不自动发布给模型。
- 卸载先拒绝新调用、移除工具并取消等待，结算在途工作，再关闭/终止并等待自己拥有的进程退出，最后释放 provider 槽位。不能只调用 kill 或等到超时就声称退出已证实。
- 崩溃/断连后停止接收动作并清空所有观察与审批；禁止重连后自动重放动作。恢复需新的 runtime generation 和观察。
- 超时或管道失败若能可靠证明只能代表取消请求，应报告实际语义；不能把 RPC cancelled 当成桌面未发生输入的证据。

## 6. 实施阶段与本地提交

### 阶段 A：依赖与隔离路径定稿

读取现状、未提交改动、相关 DSH 真实 API 和选定 Cua 版本；完成无桌面访问的版本/API/隔离可行性检查。确定唯一拓扑、部署配置、工具 schema、身份字段与图像链路。提交锁版本与设计细化；尚未验证的能力不能写成已通过。

### 阶段 B：替换后端与观察模型

实现 Cua adapter、进程所有权、发现和窗口观察；替换 helper client 与观察身份/token 模型。迁移配置、超时、错误和生命周期测试。此阶段不启动真实桌面验收。

### 阶段 C：动作、审批与图像

逐项接入受限动作、后台 delivery、执行点审批、审批后重验、取消和动作后验证；实现图像持久化与模型不支持图片的诊断。补真实 DSH Loader/tools/approval 组合测试和模型可见结果的可重放测试。原始 Cua 调用不可旁路。

### 阶段 D：清理旧运行链路与打包

删除产品 `native/` helper、C# helper 专用测试、自研协议及旧命令；更新锁文件、发布包 files、prepack、bundle 配置、验收脚本和安装说明。保留 fixture 只作 opt-in 测试。检查打包安装不依赖 dotnet runtime，旧 provider 不可启动；fixture 使用 .NET 不等于产品仍依赖 .NET。

### 阶段 E：隔离验收与交接

桌面无关测试、真实插件组合和 tarball 安装先通过。用户单独批准具体 live run 后，才在隔离 fixture/VM 验证窗口发现、截图、语义点击、输入、滚动/按键、验证结果、拒绝与退出；仅覆盖实际开放的能力，不强迫 fixture 支持不存在的动作。没有用户批准就保留“尚未 live 验证”，不能因迁移已获批准而操作真实桌面。

每个已验证的小阶段单独本地 Git commit，不 push。临时半迁移状态不能称最终完成；最终不存在两个可选桌面后端。

## 7. 测试与完成门槛

默认测试只跑本仓库明确枚举的 `test/*.test.js`。**绝不能运行不带范围的 `node --test`**：忽略目录 `OtherRepo/` 中有真实桌面自动化测试。默认测试、打包及安装 smoke 都不得枚举真实窗口、截图或发输入。

至少覆盖：

1. 非 Windows、无白名单、禁止应用、身份不足、版本/原生包/executable 不兼容时失败。
2. 启动失败、槽位占用、重复工具、坏目录/结果、超限、超时、进程崩溃、断连及在启动中卸载。
3. 跨调用者观察/审批不可复用，过期/换窗/换进程/新快照/driver 重启 token 失效；并发不污染。
4. 审批拒绝/缺失/取消、审批中目标变化、敏感目标、禁止快捷键、坐标越界和未知焦点都不发真实动作。
5. 后台拒绝不前台重试；模糊失败不重放；执行后验证失败不能报告 verified。
6. 有序图像/文本、整体结果限额、无图片模型诊断、无原始 base64 历史泄漏。
7. 通过真实 Loader/tools/approval/systemPrompt/attachment 的安装与加载，不只手写 registry mock；可见输出和日志可重放。
8. 卸载移除工具与指导、结算工作、确认进程退出后释放槽位，重复卸载安全。
9. tarball 内无旧 helper/runtime；产品安装与默认测试不依赖 dotnet；配置/README/命令与新实现一致。

完成交接必须列出：采用的版本与隔离拓扑、实际命令与结果、Git 提交、所有公开动作的约束、未验证的应用/能力，以及是否做过独立授权的 live run。不以测试数量或上游宣传代替这些证据。

## 8. 资料与版本限定

- [Cua Driver process model](https://github.com/trycua/cua/blob/main/docs/content/docs/reference/cua-driver/process-model.mdx)：当前文档区分 same-process、private worker、daemon；main 不等于已安装版本。
- [Cua Driver SDK reference](https://github.com/trycua/cua/blob/main/docs/content/docs/reference/cua-driver/sdk-reference.mdx)：private worker、运行时和 typed API 的核实入口。
- [TypeScript SDK README](https://github.com/trycua/cua/blob/main/libs/cua-driver/typescript/README.md)：初始化、关闭与 SDK 示例。
- [精确窗口操作示例](https://github.com/trycua/cua/blob/main/docs/content/docs/how-to-guides/driver/use-sdk-in-process.mdx)：快照、element token、后台动作与动作后验证；示例同进程拓扑不直接采用。
- 本地参考：`OtherRepo/deepseek-harness/packages/experimental/computer-use-cua-driver-native/` 与 `computer-use-cua-driver-mcp/`。前者是同进程封装，后者透传 MCP 工具；二者仅提供集成参考，不直接成为本项目的安全实现。

**本方案已获用户授权；代码迁移尚未开始。旧 .NET 验收状态不能用于声称 Cua 已验证。**
