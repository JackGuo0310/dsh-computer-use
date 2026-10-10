/**
 * Bounded live verification of the Cua observation and background-click path.
 *
 * This script touches exactly one application: Notepad. It refuses to run without
 * `DSH_CUA_LIVE=1`, and the click phase additionally requires `DSH_CUA_LIVE_CLICK=1`
 * so the read-only phase can be inspected first.
 *
 * `DSH_CUA_LIVE_TEXT` types into the focused window, `|` separating steps and `>`
 * introducing a key press for that step, so a step that should start on its own
 * line is written `text>Enter`. Steps are appended at the caret, so omitting the
 * separator runs two texts together on one line.
 *
 * It never uses foreground delivery, never sends raw coordinates, and never
 * launches anything unless `--open-notepad` is passed. It is not part of
 * `npm test` and is never imported by the plugin.
 *
 *   node scripts/verify-live-cua.mjs                  # read-only
 *   node scripts/verify-live-cua.mjs --open-notepad   # open Notepad first, then read
 *   DSH_CUA_LIVE_CLICK=1 node scripts/verify-live-cua.mjs --click-role document
 */

import { spawn } from 'node:child_process'

if (process.env.DSH_CUA_LIVE !== '1') {
  console.error('refusing to touch the desktop: set DSH_CUA_LIVE=1 to run this verification')
  process.exit(1)
}

const args = new Set(process.argv.slice(2))
const entry = process.env.DSH_CUA_LIVE_APP ?? 'notepad.exe'
const { configuredApps } = await import('../src/policy.js')
const allowedApps = configuredApps([entry])
const { startCuaRuntime } = await import('../src/cua-adapter.js')

const report = (label, value) => console.log(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)

function elementSummary(element) {
  return { index: element.index, role: element.role, label: element.label, enabled: element.enabled, actions: element.actions }
}

async function main() {
  if (args.has('--open-notepad')) {
    console.log('opening one Notepad window')
    spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref()
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  const runtime = await startCuaRuntime()
  try {
    const targets = await runtime.listTargets(allowedApps)
    report('allowlisted windows', targets.length)
    if (targets.length === 0) {
      console.error('no on-screen Notepad window found; open one and retry (or pass --open-notepad)')
      return 2
    }
    for (const target of targets) {
      report('  window', { pid: target.pid, windowId: target.windowId.toString(), app: target.app, title: target.title, isOnScreen: target.isOnScreen, minimized: target.minimized })
    }
    const target = targets[0]

    const text = await runtime.observe(target, { includeScreenshot: false })
    report('text snapshot', { snapshotId: text.snapshotId, truncated: text.truncated, elementCount: text.elements.length, treeBytes: Buffer.byteLength(text.treeMarkdown, 'utf8') })
    console.log('elements:')
    for (const element of text.elements.slice(0, 40)) report('  ', elementSummary(element))

    const shot = await runtime.observe(target, { includeScreenshot: true })
    report('screenshot images', shot.images.map(image => ({ mimeType: image.mimeType, bytes: image.data.length })))

    if (!process.env.DSH_CUA_LIVE_CLICK && !process.env.DSH_CUA_LIVE_TEXT) {
      console.log('read-only phase complete; set DSH_CUA_LIVE_CLICK=1 and/or DSH_CUA_LIVE_TEXT to send input')
      return 0
    }

    if (process.env.DSH_CUA_LIVE_CLICK) {
      const index = process.env.DSH_CUA_LIVE_CLICK_INDEX === undefined ? undefined : Number(process.env.DSH_CUA_LIVE_CLICK_INDEX)
      const role = process.env.DSH_CUA_LIVE_CLICK_ROLE
      const element = index === undefined
        ? (role ? shot.elements.find(item => item.role === role) : shot.elements[0])
        : shot.elements.find(item => item.index === index)
      if (!element) {
        console.error(`no snapshot element${index === undefined ? role ? ` with role ${role}` : '' : ` at index ${index}`} to click`)
        return 3
      }
      report('clicking element', elementSummary(element))
      report('action result', await runtime.click(target, element.token))

      // A fresh snapshot is the only evidence that the click landed: the driver
      // reports what it believes it did, the window reports what actually changed.
      const after = await runtime.observe(target, { includeScreenshot: false })
      const landed = after.elements.find(item => item.index === element.index)
      report('clicked element after', landed ? elementSummary(landed) : 'absent from the new snapshot')
      report('post-action snapshot', {
        snapshotId: after.snapshotId,
        elementCount: after.elements.length,
        treeChanged: after.treeMarkdown !== text.treeMarkdown,
        labelChanged: JSON.stringify(after.elements.map(e => [e.index, e.label])) !== JSON.stringify(text.elements.map(e => [e.index, e.label])),
      })
    }
    const typed = process.env.DSH_CUA_LIVE_TEXT
    if (typed !== undefined) {
      // Typing is the primary thing a computer-use provider does, so it gets its
      // own phase: literal text, then an optional key, then a read-back of the
      // window. The window's own character count is the objective evidence.
      for (const step of typed.split('|')) {
        const [textToType, keyAfter] = step.split('>')
        const before = await runtime.observe(target, { includeScreenshot: false })
        report('typing', JSON.stringify(textToType))
        report('type result', await runtime.typeText(target, textToType))
        if (keyAfter !== undefined) {
          // `Ctrl+End` is one chord: the first name is the key, the rest are the
          // modifiers held with it. Sending `Ctrl` alone is a different action.
          const parts = keyAfter.split('+').map(part => part.trim()).filter(Boolean)
          const [key, ...modifiers] = parts.length > 1 ? [parts.at(-1), ...parts.slice(0, -1)] : parts
          report('pressing key', { key, modifiers })
          report('press result', await runtime.pressKey(target, key, modifiers))
        }
        const now = await runtime.observe(target, { includeScreenshot: false })
        report('window read-back', {
          charCount: now.elements.find(item => /个字符/.test(item.label))?.label,
          treeChanged: now.treeMarkdown !== before.treeMarkdown,
        })
      }
    }
    return 0
  } finally {
    await runtime.close()
    console.log('runtime closed')
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`verification failed: ${error?.message ?? error}`)
  process.exitCode = 4
}
