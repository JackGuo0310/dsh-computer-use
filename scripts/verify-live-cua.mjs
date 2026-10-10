/**
 * Bounded live verification of the Cua observation and background-click path.
 *
 * This script touches exactly one application: Notepad. It refuses to run without
 * `DSH_CUA_LIVE=1`, and the click phase additionally requires `DSH_CUA_LIVE_CLICK=1`
 * so the read-only phase can be inspected first.
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
const allowedApps = new Set(['notepad.exe'])
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
    report('allowlisted notepad windows', targets.length)
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

    if (!process.env.DSH_CUA_LIVE_CLICK) {
      console.log('read-only phase complete; set DSH_CUA_LIVE_CLICK=1 to also deliver one background click')
      return 0
    }

    const role = process.env.DSH_CUA_LIVE_CLICK_ROLE
    const element = role ? shot.elements.find(item => item.role === role) : shot.elements[0]
    if (!element) {
      console.error(`no snapshot element${role ? ` with role ${role}` : ''} to click`)
      return 3
    }
    report('clicking element', elementSummary(element))
    const result = await runtime.click(target, element.token)
    report('action result', result)

    const after = await runtime.observe(target, { includeScreenshot: false })
    report('post-action snapshot', { snapshotId: after.snapshotId, elementCount: after.elements.length, treeChanged: after.treeMarkdown !== text.treeMarkdown })
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
