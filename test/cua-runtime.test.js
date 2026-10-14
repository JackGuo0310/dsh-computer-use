import test from 'node:test'
import assert from 'node:assert/strict'
import { CuaRuntime } from '../src/cua-adapter.js'
import { configuredApps } from '../src/policy.js'

const allowlist = (...entries) => configuredApps(entries)

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
    async listApps(input) { calls.push(['listApps', input]); return { apps: state.apps ?? [state.app ?? app] } },
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

test('a coordinate click is delivered in the background against the same window', async () => {
  const driver = stubDriver()
  const result = await new CuaRuntime(driver).clickAt(target, { x: 587, y: 58 })
  const [, input] = driver.calls.find(([name]) => name === 'click')
  assert.equal(input.target.tag, 'Window')
  assert.equal(input.target.inner.pid, 4242)
  assert.equal(input.target.inner.windowId, WINDOW_ID)
  assert.equal(input.position.tag, 'Coordinates')
  assert.deepEqual(input.position.inner, { x: 587, y: 58 })
  assert.equal(input.deliveryMode, 0, 'a pixel click must stay background too, so it never raises the window')
  assert.equal(input.count, 1)
  assert.equal(result.delivery.mode, 'background')
})

test('a coordinate outside the current window is refused before the driver is called', async () => {
  // The bounds come from a fresh window read, not from the caller's snapshot, so
  // a point cannot escape the allowlisted window onto another one.
  const driver = stubDriver()
  const runtime = new CuaRuntime(driver)
  for (const point of [{ x: 800, y: 0 }, { x: 0, y: 600 }, { x: -1, y: 10 }, { x: 10, y: -1 }]) {
    await assert.rejects(runtime.clickAt(target, point), /outside the window 800x600/)
  }
  assert.equal(driver.calls.some(([name]) => name === 'click'), false, 'no click may reach the driver')
})

test('a coordinate click refuses a fractional or missing point', async () => {
  const driver = stubDriver()
  const runtime = new CuaRuntime(driver)
  await assert.rejects(runtime.clickAt(target, { x: 1.5, y: 2 }), /whole pixels/)
  await assert.rejects(runtime.clickAt(target, { x: 1 }), /numeric x and y/)
  await assert.rejects(runtime.clickAt(target, undefined), /numeric x and y/)
  assert.equal(driver.calls.some(([name]) => name === 'click'), false)
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

test('a retitled window is still the same window, but a swapped executable is not', async () => {
  // Typing into a document renames its window. Treating the title as identity
  // broke the action path after the first typed character.
  const driver = stubDriver({ state: { window: { ...window, title: 'Cua background typing check - Notepad' } } })
  const result = await new CuaRuntime(driver).click(target, 't')
  assert.equal(result.effect, 'confirmed')
  assert.equal(driver.calls.some(([name]) => name === 'click'), true)

  const swapped = stubDriver({ state: { app: { ...app, launchPath: 'C:\\Other\\calc.exe', name: 'calc.exe' } } })
  await assert.rejects(new CuaRuntime(swapped).click(target, 't'), /window identity changed before action/)
})

test('listTargets keeps only allowlisted executables from the fresh listing', async () => {
  const driver = stubDriver()
  const targets = await new CuaRuntime(driver).listTargets(allowlist('notepad.exe'))
  assert.equal(targets.length, 1)
  assert.equal(targets[0].app, 'notepad.exe')
  assert.equal(targets[0].windowId, WINDOW_ID)
  const none = await new CuaRuntime(driver).listTargets(allowlist('other.exe'))
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
  const allowed = allowlist('notepad.exe')
  await Promise.all([runtime.listTargets(allowed), runtime.listTargets(allowed)])
  await runtime.close()
  assert.equal(driver.calls.filter(([name]) => name === 'shutdown').length, 1)
  await assert.rejects(runtime.listTargets(allowed), /closed/)
})

test('a path entry selects one exact executable and nothing else', async () => {
  const driver = stubDriver()
  const listed = await new CuaRuntime(driver).listTargets(allowlist('C:\\Windows\\System32\\notepad.exe'))
  assert.equal(listed.length, 1)
  assert.equal(listed[0].path, 'c:\\windows\\system32\\notepad.exe')
  const elsewhere = stubDriver({ state: { app: { ...app, launchPath: 'C:\\Other\\notepad.exe' } } })
  assert.deepEqual(await new CuaRuntime(elsewhere).listTargets(allowlist('C:\\Windows\\System32\\notepad.exe')), [])
})

test('listApplications returns one identity per executable, without window titles', async () => {
  const driver = stubDriver({ state: { apps: [app, { ...app, pid: 5555, launchPath: 'C:\\Windows\\System32\\calc.exe' }, { pid: 7, running: true, name: 'Notes.exe' }] } })
  const applications = await new CuaRuntime(driver).listApplications()
  assert.deepEqual(applications.map(entry => entry.name), ['calc.exe', 'notepad.exe', 'notes.exe'])
  assert.equal(applications.find(entry => entry.name === 'notepad.exe').path, 'c:\\windows\\system32\\notepad.exe')
  assert.equal(applications.find(entry => entry.name === 'notes.exe').path, undefined, 'an app with no reported path is listed by name only')
  assert.equal(JSON.stringify(applications).includes('Untitled'), false, 'window titles must never be exposed here')
})
