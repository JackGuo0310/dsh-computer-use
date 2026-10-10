# 新会话实施提示词

复制下面整段到新会话，继续推进 Cua Driver 的受控交互，不要重新讨论切换决策。

```text
请在 D:\Github\dsh-computer-use 继续推进 Cua Driver 迁移与受控交互。

用户已批准改用 Cua，旧 .NET UIA/Win32 helper 已停止并移除。@trycua/cua-driver@0.28.0 与 SDK private worker 已锁定，静态证据见 STAGE-A.md。当前运行实现只开放窗口列举和观察；SDK 未安装或运行，private worker 未实测，背景输入与 DSH 图像附件均未验证。不要访问真实桌面，也不要声称完整 Cua 能力已验收。

先读 DESIGN.md、README.md、STAGE-A.md，检查 git status、最近提交与待处理改动，再决定下一个小阶段。始终保留未跟踪 scripts/verify-live-inspect.mjs，既不修改也不提交；它仍含旧 helper 假设，不是 Cua 验收脚本，且不可运行。OtherRepo 只读。

已完成且不要回退的约束：
1. 只注册 safe_win_list_windows 与 safe_win_observe；不注册动作工具，不尝试前台点击或输入。当前没有 live 操作授权，不得枚举桌面、截图或发输入。
2. 不得在 dependencies/optionalDependencies 声明任何 @deepseek-ai/* 宿主包，也不得在运行时代码 import 它们——否则 Profile 会物化第二份 dsh-tools，TOOL_RUNTIME_SCHEDULER 变成两个不同 Symbol。test/host-dependency-isolation.test.js 固化此约束。
3. Settings 写入由声明的 Config schema 校验；独立的 /validate-config 只是 GUI 草稿预检，不保护 Settings Remote 直接写入。跨字段与危险名单规则另在插件 apply 中 fail closed。
4. src/snapshot-policy.js 与 src/operation-queue.js 刻意不 import Cua SDK，因此可在不加载原生插件的进程内测试；新的执行策略应优先放进这两处，而不是让测试去加载 native addon。
5. operation-queue 的语义：同一 runtime 一次只发一个 driver 调用；超时/取消只让调用方停止等待，被放弃的调用会把 runtime 置为 quarantine 直到 worker 真正结束，关闭前有界 drain，绝不自动重放。

下一步只能从下面两条之一推进，不要跳步：
A. 截图/图像附件：需要匹配版本的宿主附件包与真实 Loader 输出验证（本仓库 node_modules 目前没有 @deepseek-ai/dsh-attachment）。在拿到该证据前不得放开 screenshot:true 或宣称图片可交付。
B. 输入动作：需要先在隔离 fixture/VM 取得针对具体运行的 live 授权，验证 0.28.0 的后台目标语义、delivery 状态与失败/取消行为，然后才能接入一次性审批与审批后重验（进程、窗口、快照、token、driver generation）。

测试仅运行本仓库 test/*.test.js；绝不运行裸 node --test，避免发现 OtherRepo 的桌面测试。每个已验证的小阶段本地 commit，不 push；提交前检查暂存区，绝不包含 scripts/verify-live-inspect.mjs 或其他未授权用户改动。不要安装/运行 Cua、提权、改用户 DSH profile 或启动替代 GUI。

最后报告实际版本/拓扑与其验证范围、测试和打包命令结果、本地提交、开放能力及明确未验证项，并说明没有进行 live desktop run。
```
