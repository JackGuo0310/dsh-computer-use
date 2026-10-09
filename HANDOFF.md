# 新会话实施提示词

复制下面整段到新会话。目标是实施已经批准的全面迁移，不是重新讨论是否使用 Cua。

```text
请在 D:\Github\dsh-computer-use 实施 Cua Driver 全面迁移。

用户已明确批准改用 Cua，旧 .NET UIA/Win32 helper 方案在执行中被叫停；不要继续旧方案，不要仅增添一个可选 Cua 后端。请先读 DESIGN.md（唯一现行迁移方案）与 README.md，并检查 git status、当前提交和所有待处理用户改动。设计基线 HEAD 为 91d7542；此前未跟踪的 scripts/verify-live-inspect.mjs 不是可以随意丢弃的文件。

按 DESIGN.md 的阶段 A–E 实施：
1. 核实实际 Cua SDK/Windows 包/匹配 executable 的版本与 API，锁定版本及唯一进程隔离路径。优先使用官方可用的 private worker；不能把最新 main 文档当成 0.28.0 的 API 证据。若不可用，可在受管薄 Node 子进程内部加载官方 Cua SDK；子进程不得自研桌面操作。禁止在 DSH host 内直接 create() 运行原生桌面 runtime。检查 private worker 自身是否仍在 host 加载原生绑定，并准确说明隔离范围。
2. 用 Cua 实现允许应用/窗口发现、窗口可访问性与截图、受约束动作和动作后验证；保留独立插件、bundle 安装、DSH 审批及正常日志/图片链路。默认后台 delivery，拒绝不得自动前台重试。
3. 白名单仍按可执行文件名（如 notepad.exe）匹配，不改成完整路径。实际进程身份、窗口 ID、观察、element token、调用者和 driver generation 都需绑定。审批后重验，观察过期/换窗/崩溃/取消/模糊失败必须失效，不能自动重放。
4. 每个状态改变动作均一次 DSH 用户审批；缺失/拒绝/取消不得送到 driver。禁止终端、密码/登录、安全设置和 DSH 自身等目标。不能暴露上游完整工具目录或原始 arbitrary callTool 旁路，不能只靠提示词或关键词宣称安全。
5. 移除旧 helper 源码、专用 C# 协议测试、client、旧实时验收路径、dotnet 产品构建/prepack 与发布包依赖；迁移配置、锁文件、测试、打包脚本和文档。独立 .NET fixture 如有用可保留为 opt-in 测试应用，但不能作为产品后端或安装依赖。最终没有 legacy 开关、双后端或自动 fallback。
6. 补窗口身份/观察/token/并发隔离、审批、结果图像、后台拒绝、超时/取消/崩溃、启动失败、真实 Loader 组合、打包安装与卸载进程退出的测试。区别 input delivered 与 outcome verified；旧 .NET 测试不算 Cua 验收。

执行规则：
- 任务/TODO 用中文；先列具体阶段，边做边更新。
- 每个经过验证的小阶段做本地 Git commit，不 push；不重置或顺带提交用户改动。
- 默认测试只选本仓库 test/*.test.js；绝不能运行不带范围的 node --test，它会递归发现 OtherRepo 中真实桌面自动化测试。
- 未经用户针对具体运行另行批准，不枚举真实桌面、不截图、不发送输入；获得迁移授权不等于 live run 授权。需要 live 验收时提出准确的隔离 fixture/VM 范围，等待用户批准；没有批准就交接为未 live 验证。
- 不要未经允许安装 Cua、提权、修改用户现有 DSH profile 或启动替代 GUI 服务。
- OtherRepo 为参考仓库，不在其中实现产品；优先独立插件，不改 DSH 核心/GUI。必要能力缺口如实报告，不通过同进程运行或不受控工具转发规避。
- 如需工作区隔离，使用 using-git-worktrees skill，确保迁移和既有用户改动不会冲突。

开始实施，不需要重新请求“是否切换 Cua”的批准。仅真正缺少安装/运行授权或技术前提时询问具体缺项。最终报告采用版本与拓扑、实际验证命令与结果、阶段提交、删除的旧运行链路、开放能力及约束、未验证项和是否做过单独获批的 live run。
```
