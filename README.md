# DSH Windows Computer Use

独立、按需启用的 DeepSeek Harness Windows computer-use 插件。

## 当前决策与实现状态

**2026-10-09 用户已批准全面切换 Cua Driver。** 运行时代码使用 `@trycua/cua-driver@0.28.0` SDK-managed private worker。因该版本背景语义点击的行为尚未验证，当前只开放 allowlist 窗口列举和单窗口观察；不暴露任何输入动作。无截图传输/渲染的验收结论，不宣称完整 Cua 功能已通过。旧 .NET UIA/Win32 helper 产品代码已移除，不保留双后端或自动回退。

- 完整迁移方案：[DESIGN.md](<DESIGN.md>)。
- 新会话可直接使用的实施提示词：[HANDOFF.md](<HANDOFF.md>)。
- 阶段 A 的版本/API 静态证据见 [STAGE-A.md](<STAGE-A.md>)。Cua SDK 已作为开发依赖安装以供静态测试；Driver 可执行文件未安装、worker 未运行，真实桌面、截图和输入均未触及。
- 当前安全边界是**观察-only**：只注册 `safe_win_list_windows` 与 `safe_win_observe`，且不向模型暴露 Cua element token。动作、审批后执行与结果验证尚未接入；不把上游能力写成本插件已通过的能力。
- DSH 输出目前走 JSON/text 适配，不代表图像附件已被模型渲染或测试。截图选项目前拒绝 true；请勿依赖截图输出。
- SDK 的 npm 包不含 `cua-driver.exe`；私有 worker 需要另行安装固定版本的 Windows release。插件安装后在 Plugins 设置页出现 `dsh-computer-use-safe-win` 一行（同一个包名同时挂载 Host 与浏览器两半），Host 常驻在认证 API 通道上注册 `/api/computer-use-safe-win/status` 与 `/api/computer-use-safe-win/install` 两条路由，设置页提供「测试驱动」与「安装驱动」两个按钮。
  - 「测试驱动」只读受管目录，返回目标版本、已安装版本与平台支持情况；版本来自固定 checksum 的官方发行包，**未启动驱动验证**，因此界面显示「受管驱动已安装（未启动验证）」。
  - 「安装驱动」需本机浏览器同源 POST：路由地址为回环、请求头标记 same-origin、且带显式确认头，远程 Host 或跨源请求返回 403，不会下载任何内容；同一时刻只允许一次安装。
  - 安装完成后需要另行把 `config.enabled` 置为 true 并配置 `allowedApps`，观察工具才会注册；安装本身不启动 worker、不枚举桌面。默认 patch 即 `enabled: false`。
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

浏览器半的**真实渲染**未在本仓库验证：DSH 只在运行中的 Web GUI 里加载 `client.js`，本仓库无法启动替换服务器。`test/client-bundle.test.js` 在 `node:vm` 中加载真实产物并驱动组件，覆盖状态读取、安装确认、错误呈现与仅在配置页渲染，但 React 调和、slot 渲染器交互和实际点击未在此验证。安装后请在 Plugins 设置页确认 `dsh-computer-use-safe-win` 行存在、配置页出现两个按钮。

实施按小阶段做本地 Git commit，不 push。保留既有用户改动，不通过重置工作树掩盖迁移。

## 安装（按 tag）

```sh
# 在 DSH 中从私有仓库按 tag 安装 Host 插件
# 插件管理器 → 添加插件 → dsh-computer-use-safe-win
git+ssh://git@github.com/JackGuo0310/dsh-computer-use.git#<TAG>
```

安装需要可用的 SSH key。安装后在 Plugins 设置页打开 `dsh-computer-use-safe-win` 的配置页，先「测试驱动」确认状态，再按需「安装驱动」。启用观察还需在插件配置里写入 `allowedApps` 并把 `enabled` 置为 `true`。
