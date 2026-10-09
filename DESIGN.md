# Cua Driver 迁移状态与能力边界

决策日期：2026-10-09。用户已批准全面切换到 Cua Driver，以取代自研 .NET UIA/Win32 helper。本文只记录当前实现、验证范围和后续能力门禁，不把计划中的功能描述为已实现。

## 当前状态

- 锁定 `@trycua/cua-driver@0.28.0`；运行时代码选用 SDK-managed private worker。阶段 A 静态证据见 [STAGE-A.md](<STAGE-A.md>)。
- 插件只开放 `safe_win_list_windows` 和 `safe_win_observe`。动作工具未注册；不发送输入。
- 窗口按配置的 executable 文件名白名单过滤；观察绑定到 fresh listing 的 PID 与 bigint window ID，且过滤结果不向模型泄露 element token。
- `safe_win_observe` 的截图选项当前拒绝 `true`，直到 DSH 图像附件/渲染链路得到验证；tree-only 观察使用 `false`。
- Cua SDK/worker 未安装或运行，未真实枚举桌面、截图或发送输入。Worker 可用性、真实应用可访问性、截图输出及附件链路均未实测。
- SDK 的 Node native addon 仍在 DSH host 进程加载。private worker 隔离桌面 driver runtime 进程生命周期，不是 OS 沙箱，也不隔离 host native addon 自身崩溃。
- `src/policy.js` 留有动作门控逻辑，但当前插件不调用它执行动作；不得将其视为已开放能力。

## 安全约束

- 仅 Windows；白名单为非空 executable **文件名**，不是路径或签名认证。
- Cua window ID 在内部保留 bigint；DSH JSON 输出转为十进制字符串。
- 插件不向模型暴露上游完整工具目录或 arbitrary `callTool`。
- 不允许前台 fallback、自动重试模糊输入或输入动作绕过 DSH 执行入口。
- Cua 文本/图像都是不可信数据。标题/控件关键词过滤只能作为保守措施，不能完整识别业务风险。
- 未经针对具体运行的批准，不枚举真实桌面、不截图、不发输入。当前迁移授权不等于 live-run 授权。

## 能力准入门槛

增加输入动作前，须验证选定 SDK 版本的后台目标语义、delivery 状态与失败/取消行为；通过 DSH 一次性审批，并在审批后重验进程、窗口、快照、目标 token 和 driver generation。拒绝、缺失、取消或目标变化必须拒绝；送达状态模糊时不可重放。当前未满足门槛，因此没有动作工具。

输出截图前，须核实 `@deepseek-ai/dsh-tools` 的附件/图片管线并通过真实 Loader 输出测试。当前 JSON/text 适配器不能证明图片能被渲染；插件暂时拒绝截图请求，不宣称可用。

## 测试与发布

仅运行本仓库限定测试：`npm test`（`node --test test/*.test.js`）。**禁止裸 `node --test`**，因为忽略的 `OtherRepo` 含真实桌面自动化测试。

- `npm run pack:check`：tarball dry-run。
- `npm run verify:package`：scratch install、检查 tarball 无 helper、确认 patch/`./client`/locale/icon 资源完整，并通过真实 Loader 验证 observation-only 工具注册与卸载。

这些检查不启动 Cua worker，也不接触桌面。测试不能替代未验证的运行能力。

## 安装后引导与驱动管理

插件安装后只需一个包名 `dsh-computer-use-safe-win`：同一个 Loader 行同时挂载 Host 半与浏览器半（`dsh.client.platform: web` 声明使其进入浏览器模块表）。**不再声明单独的 `/client` 行**——子路径行会解析到同一包并在模块表中与包名行冲突。

Host 半常驻在认证 API 通道（`ctx.connection.fetch.register`，路径必须在 `/api` 下）上提供两条 exact 路由，由 Connection 的 Host/Origin 栅栏和浏览器认证先行裁决：

- `GET /api/computer-use-safe-win/status`：只读受管目录，区分目标版本与已安装版本，并标记 `runtimeVerified: false`。
- `POST /api/computer-use-safe-win/install`：除认证外还要求回环请求地址、same-origin 标记与显式确认头；远程 Host 或跨源请求返回 403，同一时刻只允许一次安装。

安装器固定 `0.28.0` 官方发行包的 SHA-256，校验响应来源、体积上限、ZIP 根条目与解压总量，并在临时目录完成后原子重命名；从不执行二进制。浏览器半注册 `plugins.bundle.config` 键 `dsh-computer-use-safe-win`，仅在配置页（`view === 'page'`）渲染，提供「测试驱动」与「安装驱动」。安装不启动 worker、不枚举桌面；观察须另行把 `config.enabled` 置为 true 并配置 `allowedApps`。

## 阶段

- A（版本/API/拓扑静态证据）：完成，见 STAGE-A.md；未运行 Cua。
- B（观察路径、身份校验、Loader 与生命周期）：已实现并有桌面无关测试；完整打包验证已通过。
- C（输入动作、审批后重验、结果验证、截图附件）：未完成；动作关闭，图像管线未验证。
- D（移除旧 helper 链路、测试/配置/文档/打包）：旧产品代码与测试已移除；打包校验覆盖 client/locale/icon 资源。
- E（最终审阅与本地提交）：本地提交与 tag `mvp-0.1.0` 已建立；不 push。

旧 .NET helper 测试及 live acceptance 不是 Cua 验收。用户留下的未跟踪 `scripts/verify-live-inspect.mjs` 仍引用旧 helper，按要求保持未修改、未提交且不可运行。本次未进行 live desktop run；未来 live run 需针对明确隔离 fixture/VM 另行审批。
