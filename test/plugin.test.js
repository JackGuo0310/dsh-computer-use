import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { startSafeWinProvider } from '../src/plugin.js'

const allowedApps = new Set(['notepad.exe'])
const target = {
  windowId: 4242n, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad',
  bounds: { x: 0, y: 0, width: 900, height: 700 }, isOnScreen: true, minimized: false,
}

class StubRuntime {
  closed = false
  calls = []
  constructor({ observeWait, fail = false } = {}) { this.observeWait = observeWait; this.fail = fail }
  async listTargets(apps, signal) {
    signal?.throwIfAborted()
    this.calls.push('list')
    if (this.fail) throw new Error('Cua runtime failure')
    assert.ok(apps.has('notepad.exe'))
    return [target]
  }
  async observe(window, { signal } = {}) {
    signal?.throwIfAborted()
    this.calls.push('observe')
    if (this.observeWait) await this.observeWait
    return {
      target: window, snapshotId: 'stub-snapshot-0001',
      treeMarkdown: 'Button: Next', elements: [{ index: 0, role: 'button', label: 'Next', value: '', enabled: true, selected: false, token: 'opaque-token', actions: ['click'] }],
      truncated: false, images: [],
    }
  }
  async close() { this.closed = true }
}

function harness() {
  const ctx = new Context()
  const state = { provider: null, tools: new Map(), sections: [], released: 0 }
  ctx.provide('computerUse', { register(name) {
    if (state.provider) throw new Error('computer use slot already taken')
    state.provider = name
    return async () => { state.provider = null; state.released++ }
  } })
  ctx.provide('tools', { register(definition) {
    if (state.tools.has(definition.name)) throw new Error('duplicate tool')
    state.tools.set(definition.name, definition)
    return () => state.tools.delete(definition.name)
  } })
  ctx.provide('systemPrompt', { section(value) { state.sections.push(value); return () => {} }, getSectionOrder: () => 5 })
  return { ctx, state }
}

function exec(name, signal = new AbortController().signal) {
  return { name, callId: `call-${name}`, rootCallId: 'turn-1', agent: { id: 'agent-1' }, signal }
}
function tool(state, name) {
  const value = state.tools.get(name)
  assert.ok(value, `${name} should be registered`)
  return value
}
async function start(h, factory = async () => new StubRuntime()) {
  let runtime
  await startSafeWinProvider(h.ctx, { allowedApps, startRuntime: async signal => {
    runtime = await factory(signal)
    return runtime
  } })
  return { dispose: () => h.ctx.fiber.dispose(), runtime: () => runtime }
}

test('startup registers only inspection tools and no desktop enumeration', async () => {
  const h = harness()
  const provider = await start(h)
  assert.equal(h.state.provider, 'safe-win')
  assert.deepEqual([...h.state.tools.keys()], ['safe_win_list_windows', 'safe_win_observe'])
  assert.equal(h.state.sections.length, 1)
  assert.deepEqual(provider.runtime().calls, [], 'runtime startup must not enumerate desktop state')
  await provider.dispose()
  assert.equal(provider.runtime().closed, true)
  assert.equal(h.state.provider, null)
  assert.equal(h.state.tools.size, 0)
})

test('window discovery emits opaque bigint IDs as exact decimal strings', async () => {
  const h = harness()
  const provider = await start(h)
  const result = await tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows'))
  assert.equal(result.windows[0].windowId, '4242')
  assert.equal(provider.runtime().calls.join(','), 'list')
  await provider.dispose()
})

test('observe rechecks listing and removes Cua control tokens', async () => {
  const h = harness()
  const provider = await start(h)
  const result = await tool(h.state, 'safe_win_observe').execute({ windowId: '4242', pid: 1234, screenshot: false }, exec('safe_win_observe'))
  assert.equal(result.window.windowId, '4242')
  assert.equal(result.elements[0].label, 'Next')
  assert.equal('token' in result.elements[0], false)
  assert.equal('observationId' in result, false)
  assert.equal(result.treeMarkdown, 'Button: Next')
  assert.deepEqual(result.screenshot, [])
  assert.deepEqual(provider.runtime().calls, ['list', 'observe'])
  await provider.dispose()
})

test('screenshot requests fail closed until DSH image delivery is verified', async () => {
  const h = harness()
  const provider = await start(h)
  await assert.rejects(tool(h.state, 'safe_win_observe').execute({ windowId: '4242', pid: 1234, screenshot: true }, exec('safe_win_observe')), /delivery is not verified/)
  assert.deepEqual(provider.runtime().calls, [])
  await provider.dispose()
})

test('a window absent from a fresh listing is not observed', async () => {
  const h = harness()
  const provider = await start(h, async () => Object.assign(new StubRuntime(), { listTargets: async () => [] }))
  await assert.rejects(tool(h.state, 'safe_win_observe').execute({ windowId: '4242', pid: 1234, screenshot: false }, exec('safe_win_observe')), /no longer an eligible/)
  assert.deepEqual(provider.runtime().calls, [])
  await provider.dispose()
})

test('no act tool exists while background semantic click behavior is unverified', async () => {
  const h = harness()
  const provider = await start(h)
  assert.equal(h.state.tools.has('safe_win_act'), false)
  assert.equal(h.state.tools.size, 2)
  await provider.dispose()
})

test('runtime startup failure rolls back the provider and tools', async () => {
  const h = harness()
  await assert.rejects(startSafeWinProvider(h.ctx, { allowedApps, startRuntime: async () => { throw new Error('worker startup failed') } }), /worker startup failed/)
  assert.equal(h.state.provider, null)
  assert.equal(h.state.tools.size, 0)
})

test('a taken provider slot is refused before Cua runtime starts', async () => {
  const h = harness()
  h.state.provider = 'another-provider'
  let starts = 0
  await assert.rejects(startSafeWinProvider(h.ctx, { allowedApps, startRuntime: async () => { starts++; return new StubRuntime() } }), /already taken/)
  assert.equal(starts, 0)
})

test('disposal during startup aborts and does not leak the runtime', async () => {
  const h = harness()
  let started
  const starting = new Promise(resolve => { started = resolve })
  let release
  const wait = new Promise(resolve => { release = resolve })
  const pending = startSafeWinProvider(h.ctx, { allowedApps, startRuntime: async signal => {
    started()
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('startup aborted')), { once: true })
      wait.then(resolve)
    })
    return new StubRuntime()
  } })
  await starting
  await h.ctx.fiber.dispose()
  release()
  await assert.rejects(pending, /aborted|unloading/)
  assert.equal(h.state.provider, null)
  assert.equal(h.state.tools.size, 0)
})

test('unload aborts queued work and closes runtime before releasing provider', async () => {
  const h = harness()
  const provider = await start(h)
  const list = tool(h.state, 'safe_win_list_windows')
  await provider.dispose()
  await assert.rejects(list.execute({}, exec('safe_win_list_windows')), /disposed|unloading|aborted/)
  assert.equal(provider.runtime().closed, true)
  assert.equal(h.state.provider, null)
})
