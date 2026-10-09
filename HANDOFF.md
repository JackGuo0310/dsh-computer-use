# 新会话实施提示词

复制下面整段到新会话，继续完成 Cua Driver 迁移收尾，不要重新讨论切换决策。

```text
请在 D:\Github\dsh-computer-use 继续完成 Cua Driver 全面迁移。

用户已批准改用 Cua，旧 .NET UIA/Win32 helper 已停止。阶段 A 已锁定 @trycua/cua-driver@0.28.0 与 SDK private worker，静态证据见 STAGE-A.md。当前运行实现只开放窗口列举和观察；SDK 未安装或运行，private worker 未实测，背景输入和 DSH 图像附件均未验证。不要访问真实桌面，也不要声称完整 Cua 能力已验收。

先读 DESIGN.md、README.md、STAGE-A.md，检查最新 git status、提交与待处理改动。始终保留未跟踪 scripts/verify-live-inspect.mjs，既不修改也不提交；它仍含旧 helper 假设，不是 Cua 验收脚本。OtherRepo 只读。

收尾工作：
1. 旧 helper 源码、helper 专用测试和旧 acceptance.mjs 已删除；检查 git diff 确认没有遗留产品构建或发布引用。verify-package 与文档已更新。
2. 保持 inspection-only 的窗口列举和单窗观察。不得注册动作工具，不得尝试前台点击或输入；当前未获 live 操作授权，不得列举桌面、截图或发输入。
3. 保持完整可用的 allowlist、窗口身份与白名单验证；确保模型结果中不泄露 Cua token/bigint，且工具输出满足 DSH schema。
4. 测试仅运行本仓库 test/*.test.js；绝不运行裸 node --test，避免发现 OtherRepo 的桌面测试。
5. 验证 npm test、npm run pack:check、npm run verify:package；核查 tarball 无 helper。不要安装/运行 Cua、提权、改用户 DSH profile 或启动替代 GUI。
6. 每个已验证的小阶段本地 commit，不 push；提交前检查暂存区，绝不包含 scripts/verify-live-inspect.mjs 或其他未授权用户改动。该 live-inspect 脚本因用户要求保持原样，不可运行。

最后报告实际版本/拓扑与其验证范围、测试和打包命令结果、本地提交、已移除链路、开放能力及明确未验证项，并说明没有进行 live desktop run。
```
