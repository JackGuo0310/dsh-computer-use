# Architecture and verification gates

## Integration evidence

The DSH registry admits one provider with `ctx.computerUse.register(name)`, which yields an async disposer. The experimental native provider registers tools through `ctx.tools.register`, holds the slot until calls and runtime settle, and registers model guidance with `ctx.systemPrompt.section`. Approval requests use `ctx.get('approval')?.request({agent, toolName, callId, reason, signal})` inside an open turn; only `allowed-once` permits one action. An absent answerer resolves unavailable and must stop the action. Package composition can install a plugin through a `dsh.bundle.patch` manifest; actual version and install path still require a built-package smoke test.

## Runtime proposal

An external Node/Cordis plugin owns one .NET 8 Windows helper process via length-bounded JSON lines on stdio. Only fixed, typed operations are accepted; arbitrary shell/code execution is never available. The process owns window inspection and Windows UI Automation; the plugin owns model-facing tool registration, session approvals, and an allowlisted window/observation state machine. No helper action accepts a model-provided bypass or risk override. A process is a fault/lifecycle boundary, **not an OS security sandbox**.

On load: reject non-Windows, missing mandatory executable allowlist, incompatible helper, or unavailable provider slot; rollback registrations on any failure. On unload: stop accepting calls, cancel pending work, wait for settlement, terminate the helper and only then release the provider slot. Each mutating call must check a recent observation, window identity, target-app executable identity, and current state; it consumes its observation even when an action fails ambiguously, requiring another observation. Elevated windows, ambiguity, locked sessions, or changed focus fail closed. Isolated fixture/VM only for live behavior testing.

## Approval and input

A separate `prepare` phase computes a concrete action intent from the current observation and UIA element metadata. The executor, not a model risk field or keyword list, rejects prohibited surfaces and marks uncertain input high-risk. A one-shot approval is requested at the execution point, describing target, intended action, and impact; after approval, revalidate the exact window, observation, and target before delivery. Unknown buttons, arbitrary text entry, hotkeys, and screenshot coordinates stay disabled until a defensible approval and confinement design is tested. First release can be read-only plus narrow UIA Invoke/Select/Toggle capabilities; scope expansion is a later stage. UIA can be incomplete in some apps, and foreground fallback will not be silently enabled.

## Stage checks

- Protocol validation, size/deadline limits, process startup/exit and concurrent-call teardown.
- Allowlist, denied app classes, stale/switching windows, suspicious element content, and fail-closed approval outcomes.
- DSH composition/load/unload, tool visibility, approval audit and rejected tool call, helper crash, cancellation and idempotent disposal.
- Built npm tarball contents and plugin-manager install/config path; only isolated Windows desktop fixture for UIA acceptance.
