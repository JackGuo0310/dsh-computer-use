# DSH Windows Computer Use

An opt-in Windows desktop computer-use provider for DeepSeek Harness. This project is under staged development; it does not yet expose desktop tools.

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

No stage will be pushed. Each verified stage receives its own local Git commit.

**Test safety:** `npm test` selects only `test/*.test.js` in this repository. Never run recursive `node --test` from this workspace: its ignored `OtherRepo/` contains third-party tests that can operate the real desktop. On 2026-10-09 an unscoped test run was stopped after a user-reported desktop popup; do not repeat it.
