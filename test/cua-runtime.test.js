import test from 'node:test'
import assert from 'node:assert/strict'
import { CuaRuntime } from '../src/cua-adapter.js'

const WINDOW_ID = 987654321012345678n
const app = { pid: 4242, running: true, launchPath: 'C:\\Windows\\System32\\notepad.exe' }
const window = {
  pid: 4242, windowId: WINDOW_ID, title: 'Untitled - Notepad',
  bounds: { x: 0, y: 0, width: 800, height: 600 }, isOnScreen: true, minimized: false,
}
const target = Object.freeze({
  pid: 4242, windowId: WINDOW_ID, app: 'notepad.exe', title: 'Untitled - Notepad',
  bounds: Object.freeze({ x: 0, y: 0, width: 800, height: 600 }), isOnScreen: true, minimized: false,
})

/** A driver stub that records every call; it never touches a real desktop. */
function stubDriver({ state = {}, clickResult } = {}) {
  const calls = []
  return {
    calls,
    async listApps(input) { calls.push(['listApps', input]); return { apps: [app] } },
    async listWindows(input) {
      calls.push(['listWindows', input])
      return { windows: [state.window ?? window] }
    },
    async getWindowState(input) {
      calls.push(['getWindowState', input])
      return { pid: input.pid, windowId: input.windowId, snapshotId: 'snap-1', treeMarkdown: 'Edit', elements: [], images: [], ...state.snapshot }
    },
    async click(input) {
      calls.push(['click', input])
      return clickResult ?? { effect: 0, route: 0, delivery: { mode: 0, deliveredCount: 1 }, evidence: [{ kind: 0 }] }
    },
    async verifyState(input) { calls.push(['verifyState', input]); return { ok: true } },
    async shutdown() { calls.push(['shutdown']) },
  }
}

test('a click is delivered as a background element click on the exact window', async () => {
  const driver = stubDriver()
  const result = await new CuaRuntime(driver).click(target, 'element-token-1')
  const [, input] = driver.calls.find(([name]) => name === 'click')
  assert.equal(input.target.tag, 'Window')
  assert.equal(input.target.inner.pid, 4242)
  assert.equal(input.target.inner.windowId, WINDOW_ID)
  assert.equal(input.position.tag, 'Element')
  assert.equal(input.position.inner.elementToken, 'element-token-1')
  assert.equal(input.deliveryMode, 0, 'delivery must be InputDeliveryMode.Background')
  assert.equal(input.count, 1)
  assert.deepEqual(result, { effect: 'confirmed', route: 'accessibility', delivery: { mode: 'background', deliveredCount: 1 }, evidenceCount: 1 })
  assert.ok(Object.isFrozen(result))
})

test('the driver outcome is reported by name and an unknown outcome is refused', async () => {
  const runtime = driver => new CuaRuntime(driver)
  const partial = await runtime(stubDriver({ clickResult: { effect: 1, route: 2, delivery: { mode: 1 } } })).click(target, 't')
  assert.equal(partial.effect, 'partial')
  assert.equal(partial.route, 'global-input')
  assert.equal(partial.delivery.mode, 'foreground')
  assert.equal(partial.delivery.deliveredCount, undefined)
  const refused = await runtime(stubDriver({ clickResult: { effect: 4, route: 0 } })).click(target, 't')
  assert.equal(refused.effect, 'refused')
  assert.equal(refused.delivery, undefined)
  await assert.rejects(runtime(stubDriver({ clickResult: { effect: 99, route: 0 } })).click(target, 't'), /unrecognized action result/)
})

test('a click refuses a missing or oversized element token without calling the driver', async () => {
  for (const token of ['', null, undefined, 'x'.repeat(1025), 42]) {
    const driver = stubDriver()
    await assert.rejects(new CuaRuntime(driver).click(target, token), /invalid Cua element token/)
    assert.deepEqual(driver.calls, [], 'no driver call may happen for an invalid token')
  }
})

test('a click is refused when the window identity changed after the snapshot', async () => {
  const driver = stubDriver({ state: { window: { ...window, title: 'Something else' } } })
  await assert.rejects(new CuaRuntime(driver).click(target, 't'), /window identity changed before action/)
  assert.equal(driver.calls.some(([name]) => name === 'click'), false)
})

test('listTargets keeps only allowlisted executables from the fresh listing', async () => {
  const driver = stubDriver()
  const targets = await new CuaRuntime(driver).listTargets(new Set(['notepad.exe']))
  assert.equal(targets.length, 1)
  assert.equal(targets[0].app, 'notepad.exe')
  assert.equal(targets[0].windowId, WINDOW_ID)
  const none = await new CuaRuntime(driver).listTargets(new Set(['other.exe']))
  assert.deepEqual(none, [])
})

test('observe re-reads the window and projects a bounded snapshot', async () => {
  const driver = stubDriver({ state: { snapshot: { elements: [{ elementIndex: 0, role: 'button', label: 'Save' }], images: [] } } })
  const snapshot = await new CuaRuntime(driver).observe(target)
  assert.equal(snapshot.snapshotId, 'snap-1')
  assert.equal(snapshot.elements[0].label, 'Save')
  assert.deepEqual(snapshot.images, [])
  assert.deepEqual(driver.calls.map(([name]) => name), ['listApps', 'listWindows', 'getWindowState'])
})

test('the runtime serializes calls and shuts the driver down once', async () => {
  const driver = stubDriver()
  const runtime = new CuaRuntime(driver)
  await Promise.all([runtime.listTargets(new Set(['notepad.exe'])), runtime.listTargets(new Set(['notepad.exe']))])
  await runtime.close()
  assert.equal(driver.calls.filter(([name]) => name === 'shutdown').length, 1)
  await assert.rejects(runtime.listTargets(new Set(['notepad.exe'])), /closed/)
})
