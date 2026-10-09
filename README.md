# DSH Windows Computer Use

An opt-in Windows desktop computer-use provider for DeepSeek Harness. The three tools
(`safe_win_inspect`, `safe_win_observe`, `safe_win_act`) are gated on a configured executable
allowlist, a fresh observation, and one-time user approval. No stage of this project has been
verified against a live desktop.

## Scope and safety

- No desktop input, screenshots, or window inspection during development on a user's live desktop. Verify UI automation only in an isolated fixture or VM with explicit consent.
- A configured executable allowlist is mandatory. The implementation must bind each action to a fresh observation of a selected window and re-check its identity immediately before input.
- Programmatic UI Automation is preferred over foreground pointer/keyboard input. Foreground input can move the user's pointer and focus and cannot be confined by a helper process.
- Disallow terminals, login/password flows, security settings, and DSH itself. Ask for an explicit one-time user decision before a concrete sensitive or irreversible action; model-authored risk labels are not authority.
- Treat displayed application content as untrusted instructions. Cancellation cannot retract input already delivered.

## Milestones

1. Baseline design and verified DSH integration points.
2. Windows helper protocol, policy, and isolated tests.
3. Plugin provider integration, approval, cancellation, and disposal tests.
4. Packaging, configuration, isolated acceptance, and security review.

Milestones 1–3 have local commits, and packaging is verified by
`npm run verify:package`. No UIA behavior has been observed: the one live run reached a
read-only observation of an empty Notepad window, which legitimately contained no actionable
control.

## Build and install

```sh
npm install
npm test                  # scoped, desktop-free
npm run build:helper      # dotnet publish into native/publish/
npm run verify:package    # packs, installs into a scratch tree, loads via the real Loader
npm pack                  # prepack rebuilds the helper first
```

`npm run verify:package` is the install-path proof: it packs the tarball, installs it into a
temporary directory, resolves it by package name, checks the helper runtime and bundle patch
shipped inside it, and loads it through the real Loader with the real tools and systemPrompt
services. It stubs only the helper process, so no desktop is touched.

The package declares `dsh.bundle.patch`, so the plugin manager installs it as a bundle layer.
`allowedApps` has no default: an empty or forbidden entry fails the plugin load on purpose.

No stage will be pushed. Each verified stage receives its own local Git commit.

**Test safety:** `npm test` selects only `test/*.test.js` in this repository. Never run recursive `node --test` from this workspace: its ignored `OtherRepo/` contains third-party tests that can operate the real desktop. On 2026-10-09 an unscoped test run was stopped after a user-reported desktop popup; do not repeat it.
