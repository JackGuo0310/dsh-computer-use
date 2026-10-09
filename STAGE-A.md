# 阶段 A：Cua 版本与隔离门禁

状态：已核实，实施锁定。该记录描述包体与类型检查，不代表安装或运行 Cua，也未访问桌面。

## 锁定版本

- `@trycua/cua-driver@0.28.0`，npm 主包 integrity：`sha512-n3ArFsQ9RzNQIiYpHJEjTGLIPPpnqXDJRp0sevRcrRThAG3H2Fh/gWooEb9k4ba3rNSAohUoPiG/EbdKLF1WRw==`
- Windows x64 可选包 `@trycua/cua-driver-win32-x64-msvc@0.28.0`；registry integrity：`sha512-tTWcGIGUCZ/k+mbcdh/4VmehsELp12M/tUj59XQSW97lFwrMSSIUypZ84LAEO+CEBdK9NQBRKO2pMBTH6aakEQ==`。
- Windows ARM64 对应 `@trycua/cua-driver-win32-arm64-msvc@0.28.0`。主包 optionalDependencies 锁定平台原生包，实际安装按 npm 的平台/CPU 选择。
- `@trycua/cua-driver@0.28.0` 已从 registry tarball 静态解压检查类型；Windows x64 release binary zip `cua-driver-rs-0.28.0-windows-x86_64-binary.zip` SHA256 `9DB2096DF8D80DA4E73FFB797947DCDFAB2A362FADDD9D1B77682C77AACE5AA9`，列有 `cua-driver.exe`、`cua-driver-uia.exe`、SDK DLL 与 Node runtime addon。此包清单检查不是执行验证。

## SDK API / 唯一拓扑

- 精确 0.28.0 SDK 声明 `CuaDriver.createPrivateWorker(PrivateWorkerOptions)`，其选项要求 binaryPath、hostBundleId、configuredDriver、environment、inheritStderr；注释定义其直接启动指定 Cua Driver binary，经继承 stdio 通信、不创建 daemon 或可重连端点。类型声明存在可以证明 API 契约，不证明匹配 executable 已安装或 worker 在本机可正常启动。
- 采用 SDK private worker 作为唯一隔离路径：DSH plugin 通过懒加载 Cua SDK 并创建该 worker；不在 DSH host 调用 `CuaDriver.create()`。Host 仍加载 SDK 的 Node native addon，因此 worker 崩溃不应等同 host 本身被隔离；它隔离的是桌面 driver runtime/子进程生命周期，不是 OS 沙箱，也不承诺抵御 host 中 native binding 的崩溃。进程仍有当前交互用户桌面权限。
- 精确 API 包含 `listApps`、`listWindows`、`getWindowState`、typed `click` 与 `shutdown`。窗口 ID 为 bigint；快照含 pid/windowId/elements/degraded 与截图字段。点击目标/位置/送达模式是显式类型，后台枚举为 `InputDeliveryMode.Background`。
- 实现只提供本插件 curated 工具；不向模型注册上游完整目录，不使用 arbitrary `callTool`。不启用失败自动回退；后台拒绝必须明确失败。

## 限制

- 本次没有安装或运行 Cua、没有访问桌面；不会在此阶段探测实时窗口。启动路径仅允许非桌面握手/元数据，不枚举应用、窗口或截图。
- Cua/worker 进程依然有桌面用户权限；Windows Session 0 / SSH 非交互服务进程不可假定能够访问登录桌面。
- 上游 native package 许可包含 MIT AND MPL-2.0；发布前需维护者完成许可审阅。
