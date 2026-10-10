import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { startSafeWinProvider } from '../src/plugin.js'

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
/** The provider reads live settings per call; tests supply one fixed state. */
function settings(allowedApps = ['notepad.exe'], enabled = true) {
  return () => ({ enabled, allowedApps })
}

/** The provider reads live settings per call; tests mutate this holder in place. */
function liveSettings(enabled = true, allowedApps = ['notepad.exe']) {
  return { enabled, allowedApps }
}

async function start(h, factory = async () => new StubRuntime(), live = liveSettings()) {
  let runtime
  let starts = 0
  await startSafeWinProvider(h.ctx, {
    readSettings: () => ({ enabled: live.enabled, allowedApps: [...live.allowedApps] }),
    startRuntime: async signal => {
      starts += 1
      runtime = await factory(signal)
      return runtime
    },
  })
  return { dispose: () => h.ctx.fiber.dispose(), runtime: () => runtime, starts: () => starts, live }
}

test('startup registers only inspection tools and starts no worker', async () => {
  const h = harness()
  const provider = await start(h)
  assert.equal(h.state.provider, 'safe-win')
  assert.deepEqual([...h.state.tools.keys()], ['safe_win_list_windows', 'safe_win_observe'])
  assert.equal(h.state.sections.length, 1)
  assert.equal(provider.starts(), 0, 'mounting the provider must not start or enumerate the desktop')
  assert.equal(provider.runtime(), undefined)
  await provider.dispose()
  assert.equal(h.state.provider, null)
  assert.equal(h.state.tools.size, 0)
})

test('the allowlist is read per call, so an edit applies to the next call', async () => {
  const h = harness()
  const provider = await start(h)
  const first = await tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows'))
  assert.equal(first.windows.length, 1)
  provider.live.allowedApps = ['other.exe']
  await assert.rejects(tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows')), /outside the allowlist/)
  assert.equal(provider.starts(), 1, 'the worker is started once and reused')
  await provider.dispose()
})

test('disabling observation refuses both tools without touching the worker', async () => {
  const h = harness()
  const provider = await start(h)
  provider.live.enabled = false
  await assert.rejects(tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows')), /observation is disabled/)
  await assert.rejects(tool(h.state, 'safe_win_observe').execute({ windowId: '4242', pid: 1234, screenshot: false }, exec('safe_win_observe')), /observation is disabled/)
  assert.equal(provider.starts(), 0)
  await provider.dispose()
})

test('an invalid live allowlist keeps the provider mounted and fails calls closed', async () => {
  for (const allowedApps of [['powershell.exe'], ['Notepad.exe', 'notepad.exe'], Array.from({ length: 65 }, (_, index) => `app${index}.exe`)]) {
    const h = harness()
    const provider = await start(h, async () => new StubRuntime(), liveSettings(true, allowedApps))
    // A bad persisted value must not unmount the settings surface, or the user
    // could not repair it from the GUI that wrote it.
    assert.equal(h.state.provider, 'safe-win')
    assert.deepEqual([...h.state.tools.keys()], ['safe_win_list_windows', 'safe_win_observe'])
    await assert.rejects(tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows')), /forbidden application|duplicate|64 applications/)
    assert.equal(provider.starts(), 0, 'no worker may start for a refused allowlist')
    await provider.dispose()
  }
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
  assert.equal(provider.starts(), 0)
  await provider.dispose()
})

test('a window absent from a fresh listing is not observed', async () => {
  const h = harness()
  const provider = await start(h, async () => Object.assign(new StubRuntime(), { listTargets: async () => [] }))
  await assert.rejects(tool(h.state, 'safe_win_observe').execute({ windowId: '4242', pid: 1234, screenshot: false }, exec('safe_win_observe')), /no longer an eligible/)
  assert.equal(provider.starts(), 1)
  await provider.dispose()
})

test('no act tool exists while background semantic click behavior is unverified', async () => {
  const h = harness()
  const provider = await start(h)
  assert.equal(h.state.tools.has('safe_win_act'), false)
  assert.equal(h.state.tools.size, 2)
  await provider.dispose()
})

test('a failed worker start surfaces on the first call and can be retried', async () => {
  const h = harness()
  let attempts = 0
  const provider = await start(h, async () => {
    attempts += 1
    if (attempts === 1) throw new Error('worker startup failed')
    return new StubRuntime()
  })
  assert.equal(h.state.provider, 'safe-win', 'the provider stays mounted so the failure is actionable')
  await assert.rejects(tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows')), /worker startup failed/)
  const result = await tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows'))
  assert.equal(result.windows.length, 1, 'a later call retries the start instead of staying broken')
  assert.equal(attempts, 2)
  await provider.dispose()
})

test('a taken provider slot is refused before any worker starts', async () => {
  const h = harness()
  h.state.provider = 'another-provider'
  let starts = 0
  await assert.rejects(startSafeWinProvider(h.ctx, {
    readSettings: () => ({ enabled: true, allowedApps: ['notepad.exe'] }),
    startRuntime: async () => { starts += 1; return new StubRuntime() },
  }), /already taken/)
  assert.equal(starts, 0)
})

test('disposal during a lazy worker start aborts the start and leaks nothing', async () => {
  const h = harness()
  let started
  const starting = new Promise(resolve => { started = resolve })
  let release
  const wait = new Promise(resolve => { release = resolve })
  const provider = await start(h, async signal => {
    started()
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('startup aborted')), { once: true })
      wait.then(resolve)
    })
    return new StubRuntime()
  })
  const call = tool(h.state, 'safe_win_list_windows').execute({}, exec('safe_win_list_windows'))
  await starting
  await provider.dispose()
  release()
  await assert.rejects(call, /aborted|unloading|disposed/)
  assert.equal(h.state.provider, null)
  assert.equal(h.state.tools.size, 0)
  assert.equal(provider.runtime(), undefined, 'an aborted start must not retain a runtime')
})

test('unload aborts queued work and closes the worker before releasing the provider', async () => {
  const h = harness()
  const provider = await start(h)
  const list = tool(h.state, 'safe_win_list_windows')
  await list.execute({}, exec('safe_win_list_windows'))
  const started = provider.runtime()
  await provider.dispose()
  await assert.rejects(list.execute({}, exec('safe_win_list_windows')), /disposed|unloading|aborted/)
  assert.equal(started.closed, true, 'a started worker is closed on unload')
  assert.equal(h.state.provider, null)
})
