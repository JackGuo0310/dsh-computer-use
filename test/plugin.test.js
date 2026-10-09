import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { startSafeWinProvider } from '../src/plugin.js'

const ALLOWED = ['notepad.exe']

/** A helper stub that answers the four protocol operations deterministically. */
class StubHelper {
  window = { hwnd: 4242, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad' }
  calls = []
  closed = false
  constructor(behavior = {}) {
    this.behavior = behavior
  }

  async call(method, parameters, signal) {
    signal?.throwIfAborted()
    this.calls.push({ method, parameters })
    if (this.behavior.fail && this.behavior.fail === method) throw new Error('helper failure')
    if (method === 'inspect') return { ...this.window, ...(this.behavior.window ?? {}) }
    if (method === 'observe') return {
      window: this.window,
      observationId: 'a'.repeat(32),
      elements: [{ type: 'Button', name: 'Save', automationId: 'save', password: false, patterns: ['Invoke'] }],
    }
    if (method === 'invoke') return { invoked: parameters }
    throw new Error(`unexpected method ${method}`)
  }

  async close() { this.closed = true }
}

/** Build a root context exposing the four services this provider consumes. */
function harness({ approval, tools = {}, computerUse = {} } = {}) {
  const ctx = new Context()
  const state = { registrations: [], definitions: [], prompts: [], providers: [], released: 0 }
  // The real registry returns an async disposer synchronously, so this stub must too.
  ctx.provide('computerUse', {
    register(name) {
      if (state.providers.length) throw new Error('computer use slot already taken')
      state.providers.push(name)
      return async () => { state.providers.pop(); state.released++ }
    },
    ...computerUse,
  })
  state.ctx = ctx
  ctx.provide('tools', {
    // The real ToolRuntime returns the exact disposer, so this stub must too.
    register(definition) {
      state.registrations.push(definition.name)
      state.definitions.push(definition)
      return () => {
        state.registrations = state.registrations.filter(entry => entry !== definition.name)
        state.definitions = state.definitions.filter(entry => entry !== definition)
      }
    },
    ...tools,
  })
  ctx.provide('systemPrompt', {
    section(descriptor) { state.prompts.push(descriptor) },
    getSectionOrder(key) { return key === 'TOOL_COMPUTER_USE' ? 5 : 0 },
  })
  if (approval !== null) ctx.provide('approval', approval ?? { request: async () => 'allowed-once' })
  return { ctx, state }
}

/** Minimal tool execution context accepted by the registered definitions. */
function execContext(signal = new AbortController().signal) {
  return { callId: 'call-1', name: 'safe_win_act', agent: { id: 'agent-1' }, signal }
}

function toolOf(state, name) {
  const definition = state.definitions.find(entry => entry.name === name)
  if (!definition) throw new Error(`tool ${name} was not registered`)
  return { execute: (args, exec) => definition.execute(args, exec) }
}

async function load(harness, helperOptions) {
  const helper = new StubHelper(helperOptions)
  const runtime = await startSafeWinProvider(harness.ctx, {
    allowedApps: new Set(ALLOWED),
    startHelper: async () => helper,
  })
  return { helper, runtime }
}

test('startup registers one provider slot, three tools and one prompt section', async () => {
  const h = harness()
  const { runtime, helper } = await load(h)
  assert.deepEqual(h.state.providers, ['safe-win'])
  assert.deepEqual(h.state.registrations, ['safe_win_inspect', 'safe_win_observe', 'safe_win_act'])
  assert.equal(h.state.prompts.length, 1)
  assert.equal(helper.calls.length, 0, 'no desktop call happens during startup')
  await runtime.dispose()
  assert.deepEqual(h.state.providers, [])
  assert.deepEqual(h.state.registrations, [])
  assert.equal(helper.closed, true)
})

test('unload releases the slot only after the helper closes', async () => {
  const h = harness()
  const { runtime, helper } = await load(h)
  let helperClosedAtRelease = null
  await runtime.dispose()
  helperClosedAtRelease = h.state.released
  assert.equal(h.state.released, 1)
  assert.equal(helperClosedAtRelease, 1)
})

test('helper startup failure rolls back registrations and rejects the load', async () => {
  const h = harness()
  await assert.rejects(startSafeWinProvider(h.ctx, {
    allowedApps: new Set(ALLOWED),
    startHelper: async () => { throw new Error('helper missing') },
  }), /helper missing/)
  assert.deepEqual(h.state.providers, [], 'the exclusive slot is released after rollback')
  assert.deepEqual(h.state.registrations, [])
})

test('a taken provider slot is refused before any helper starts', async () => {
  const h = harness()
  h.state.providers.push('someone-else')
  let started = 0
  await assert.rejects(startSafeWinProvider(h.ctx, {
    allowedApps: new Set(ALLOWED),
    startHelper: async () => { started++; return new StubHelper() },
  }), /already taken/)
  assert.equal(started, 0)
  assert.deepEqual(h.state.registrations, [])
})

test('disposal during startup aborts the handshake and leaks no helper', async () => {
  const h = harness()
  let helper
  const runtime = startSafeWinProvider(h.ctx, {
    allowedApps: new Set(ALLOWED),
    startHelper: async signal => {
      helper = new StubHelper()
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      return helper
    },
  })
  await h.ctx.fiber.dispose()
  await assert.rejects(runtime, /aborted|unloading|plugin unloaded/)
  assert.deepEqual(h.state.providers, [])
  assert.deepEqual(h.state.registrations, [])
})

test('approval refusal never reaches the helper and cannot be retried', async () => {
  const asked = []
  const h = harness({ approval: { request: async request => { asked.push(request); return 'rejected' } } })
  const { runtime, helper } = await load(h)
  const act = toolOf(h.state, 'safe_win_act')
  const observation = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  await assert.rejects(act.execute({ observationId: observation.observationId, index: 0, action: 'Invoke' }, execContext()), /not approved/)
  assert.deepEqual(asked.map(request => request.toolName), ['safe_win_act'])
  assert.match(asked[0].reason, /notepad\.exe/)
  assert.equal(helper.calls.some(entry => entry.method === 'invoke'), false)
  await runtime.dispose()
})

test('a missing approver fails closed without asking anyone', async () => {
  const h = harness({ approval: null })
  const { runtime } = await load(h)
  const act = toolOf(h.state, 'safe_win_act')
  const observation = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  await assert.rejects(act.execute({ observationId: observation.observationId, index: 0, action: 'Invoke' }, execContext()), /unavailable/)
  await runtime.dispose()
})

test('an approved action revalidates the window, then delivers exactly one invoke', async () => {
  const h = harness()
  const { runtime, helper } = await load(h)
  const act = toolOf(h.state, 'safe_win_act')
  const observation = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  const result = await act.execute({ observationId: observation.observationId, index: 0, action: 'Invoke' }, execContext())
  assert.deepEqual(result, { invoked: { observationId: 'a'.repeat(32), index: 0, action: 'Invoke' } })
  assert.deepEqual(helper.calls.map(entry => entry.method), ['inspect', 'observe', 'inspect', 'invoke'])
  await runtime.dispose()
})

test('a window that changed after approval fails closed before delivery', async () => {
  const h = harness()
  const { runtime, helper } = await load(h, { window: { title: 'Untitled - Notepad (Copy)' } })
  const act = toolOf(h.state, 'safe_win_act')
  const observation = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  await assert.rejects(act.execute({ observationId: observation.observationId, index: 0, action: 'Invoke' }, execContext()), /window changed/)
  assert.equal(helper.calls.some(entry => entry.method === 'invoke'), false)
  await runtime.dispose()
})

test('cancelling a pending action prevents any later delivery', async () => {
  const controller = new AbortController()
  let sawApproval = false
  const h = harness({ approval: { request: async () => { sawApproval = true; controller.abort(new Error('cancelled')); return 'allowed-once' } } })
  const { runtime, helper } = await load(h)
  const act = toolOf(h.state, 'safe_win_act')
  const observation = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  await assert.rejects(act.execute({ observationId: observation.observationId, index: 0, action: 'Invoke' }, execContext(controller.signal)), /cancelled/)
  assert.equal(sawApproval, true)
  assert.equal(helper.calls.some(entry => entry.method === 'invoke'), false)
  await runtime.dispose()
})

test('an observation from another window cannot act on this one', async () => {
  const h = harness()
  const { runtime } = await load(h)
  const act = toolOf(h.state, 'safe_win_act')
  const observation = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  await assert.rejects(act.execute({ observationId: 'not-the-issued-id', index: 0, action: 'Invoke' }, execContext()), /stale observation/)
  await runtime.dispose()
})

test('a helper crash surfaces to the caller instead of hanging', async () => {
  const h = harness()
  const { runtime, helper } = await load(h, { fail: 'inspect' })
  await assert.rejects(toolOf(h.state, 'safe_win_inspect').execute({ hwnd: 4242 }, execContext()), /helper failure/)
  await runtime.dispose()
})

test('unload aborts an in-flight call and drains before releasing the slot', async () => {
  const h = harness()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const helper = {
    closed: false,
    async call(method) { if (method === 'observe') await gate; return { window: { hwnd: 1, pid: 2, app: 'notepad.exe', title: 'x' }, observationId: 'a'.repeat(32), elements: [] } },
    async close() { this.closed = true },
  }
  const runtime = await startSafeWinProvider(h.ctx, { allowedApps: new Set(ALLOWED), startHelper: async () => helper })
  const inflight = toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  const disposing = runtime.dispose()
  release()
  await assert.rejects(inflight)
  await disposing
  assert.equal(helper.closed, true, 'the helper closes only after the call settles')
  assert.deepEqual(h.state.providers, [])
})

test('a helper crash while approval is pending never delivers the action', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let approved = false
  const helper = {
    closed: false,
    invoked: false,
    async call(method) {
      if (method === 'observe') return { window: { hwnd: 4242, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad' }, observationId: 'a'.repeat(32), elements: [{ type: 'Button', name: 'Apply', automationId: 'apply', password: false, patterns: ['Invoke'] }] }
      if (method === 'invoke') { this.invoked = true; return { delivered: true } }
      // The helper dies once the user has decided, before the action is delivered.
      if (approved) throw new Error('helper exited')
      return { hwnd: 4242, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad' }
    },
    async close() { this.closed = true },
  }
  const h = harness({ approval: { request: async () => { await pending; approved = true; return 'allowed-once' } } })
  const runtime = await startSafeWinProvider(h.ctx, { allowedApps: new Set(ALLOWED), startHelper: async () => helper })
  const observed = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  const acting = toolOf(h.state, 'safe_win_act').execute({ observationId: observed.observationId, index: 0, action: 'Invoke' }, execContext())
  release()
  await assert.rejects(acting, /helper exited/)
  assert.equal(helper.invoked, false, 'a crashed helper must not receive an invoke')
  await runtime.dispose()
})

test('a helper crash never resurrects the consumed observation', async () => {
  const h = harness()
  const { runtime, helper } = await load(h, { fail: 'invoke' })
  const observed = await toolOf(h.state, 'safe_win_observe').execute({ hwnd: 4242 }, execContext())
  const id = observed.observationId
  await assert.rejects(toolOf(h.state, 'safe_win_act').execute({ observationId: id, index: 0, action: 'Invoke' }, execContext()))
  await assert.rejects(toolOf(h.state, 'safe_win_act').execute({ observationId: id, index: 0, action: 'Invoke' }, execContext()), /stale/)
  await runtime.dispose()
})

test('an invalid allowlist never reaches the helper', async () => {
  const h = harness()
  await assert.rejects(startSafeWinProvider(h.ctx, {
    allowedApps: new Set(['powershell.exe']),
    startHelper: async () => new StubHelper(),
  }), /forbidden application/)
  assert.deepEqual(h.state.providers, [])
})