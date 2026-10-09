import test from 'node:test'
import assert from 'node:assert/strict'
import { ObservationGate, configuredApps } from '../src/policy.js'

const window = { hwnd: 100, pid: 22, app: 'fixture.exe', title: 'Fixture' }
const elements = [{ type: 'Button', name: 'Next', automationId: 'next', password: false, patterns: ['Invoke'] }]
const helperId = '0123456789abcdef0123456789abcdef'
const run = (gate, id, options = {}) => gate.execute({ owner: options.owner ?? 'agent-a', observationId: id, index: 0, action: 'Invoke', currentWindow: async () => window, approve: async () => 'allowed-once', deliver: async () => 'delivered', ...options })

test('requires a nonempty explicit app allowlist and rejects protected executables', () => {
  assert.throws(() => configuredApps([]), /allowlist/)
  assert.throws(() => configuredApps(['powershell.exe']), /forbidden/)
  assert.throws(() => configuredApps(['dsh.exe']), /forbidden/)
})

test('approval precedes revalidation and delivery; observation is consumed', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const observed = gate.record('agent-a', window, elements, helperId)
  const events = []
  assert.equal(await run(gate, observed.observationId, { approve: async () => { events.push('approve'); return 'allowed-once' }, currentWindow: async () => { events.push('check'); return window }, deliver: async () => { events.push('deliver'); return 'done' } }), 'done')
  assert.deepEqual(events, ['approve', 'check', 'deliver'])
  await assert.rejects(run(gate, observed.observationId), /stale observation/)
})

test('approval refusal never delivers, and does not allow retry', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record('agent-a', window, elements, helperId)
  await assert.rejects(run(gate, id, { approve: async () => 'unavailable', deliver: () => { throw Error('delivered') } }), /not approved/)
  await assert.rejects(run(gate, id), /stale/)
})

test('window changes after approval fail closed', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record('agent-a', window, elements, helperId)
  await assert.rejects(run(gate, id, { currentWindow: async () => ({ ...window, pid: 33 }), deliver: () => { throw Error('delivered') } }), /window changed/)
})

test('a sensitive control never reaches the model, and indices stay aligned', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const mixed = [
    { type: 'Button', name: 'Delete all', automationId: 'del', password: false, patterns: ['Invoke'] },
    { type: 'Button', name: 'Next', automationId: 'next', password: false, patterns: ['Invoke'] },
    { type: 'CheckBox', name: '发送邮件', automationId: 'send', password: false, patterns: ['Toggle'] },
  ]
  const observed = gate.record('agent-a', window, mixed, helperId)
  assert.deepEqual(observed.elements.map(e => e.name), ['Next'])
  // The model addresses its own filtered view; delivery must reach helper control 1.
  const delivered = []
  await run(gate, observed.observationId, { deliver: async payload => { delivered.push(payload.index); return 'ok' } })
  assert.deepEqual(delivered, [1])
})

test('an observation containing only sensitive controls is refused', () => {
  const gate = new ObservationGate(['fixture.exe'])
  assert.throws(() => gate.record('agent-a', window, [
    { type: 'Button', name: 'Uninstall', automationId: 'u', password: false, patterns: ['Invoke'] },
  ], helperId), /no safely actionable control/)
})

test('a blank-named control is refused before it reaches the model', () => {
  const gate = new ObservationGate(['fixture.exe'])
  assert.throws(() => gate.record('agent-a', window, [
    { type: 'Button', name: '   ', automationId: 'blank', password: false, patterns: ['Invoke'] },
  ], helperId), /no safely actionable control/)
})

test('the window is rechecked after approval and before delivery', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record('agent-a', window, elements, helperId)
  const events = []
  // The window is unchanged at revalidation, so delivery proceeds.
  assert.equal(await run(gate, id, {
    currentWindow: async () => { events.push('revalidate'); return window },
    deliver: async () => { events.push('deliver'); return 'ok' },
  }), 'ok')
  assert.deepEqual(events, ['revalidate', 'deliver'], 'delivery follows the revalidation, never precedes it')
})

test('a window replaced during approval fails closed before delivery', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record('agent-a', window, elements, helperId)
  await assert.rejects(run(gate, id, {
    currentWindow: async () => ({ ...window, pid: 44 }),
    deliver: () => { throw Error('delivered') },
  }), /window changed/)
})

test('the reported index maps back to the same helper-side control', async () => {
  // The helper keeps every control it reported, in its own order; only the model
  // view is filtered. If the helper ever filtered first, this mapping would
  // silently address the wrong control, so the contract is pinned here.
  const gate = new ObservationGate(['fixture.exe'])
  const helperOrder = ['Delete', 'Next', 'Save', '发送']
  const observed = gate.record('agent-a', window, helperOrder.map((name, index) => ({
    type: 'Button', name, automationId: `id-${index}`, password: false, patterns: ['Invoke'],
  })), helperId)
  assert.deepEqual(observed.elements.map(element => element.name), ['Next', 'Save'])
  // The reported index is the position in the filtered view; it is deliberately
  // not the helper-side index, which the mapping resolves at delivery.
  assert.deepEqual(observed.elements.map(element => element.index), [0, 1])
  const delivered = []
  await run(gate, observed.observationId, { index: 1, deliver: async p => { delivered.push(p.index) } })
  assert.deepEqual(delivered, [2], 'model index 1 (Save) must reach helper control 2')
})

test('two agents do not share observation state', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const a = gate.record('agent-a', window, elements, helperId)
  const b = gate.record('agent-b', window, elements, helperId)
  // B observing must not invalidate A's pending action, and vice versa.
  assert.equal(await run(gate, a.observationId), 'delivered')
  assert.equal(await run(gate, b.observationId, { owner: 'agent-b' }), 'delivered')
})

test('one agent acting does not block another agent observing', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const a = gate.record('agent-a', window, elements, helperId)
  let release
  const approval = new Promise(resolve => { release = resolve })
  const running = run(gate, a.observationId, { approve: () => approval })
  // B may observe and act while A's approval is still pending.
  const b = gate.record('agent-b', window, elements, helperId)
  assert.equal(await run(gate, b.observationId, { owner: 'agent-b' }), 'delivered')
  release('allowed-once')
  assert.equal(await running, 'delivered')
})

test('one agent cannot act on another agent observation id', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const a = gate.record('agent-a', window, elements, helperId)
  await assert.rejects(run(gate, a.observationId, { owner: 'agent-b' }), /stale observation/)
})

test('dangerous window titles cannot be observed at all', () => {
  const gate = new ObservationGate(['fixture.exe'])
  assert.throws(() => gate.record('agent-a', { ...window, title: 'Security Settings' }, elements, helperId), /unsafe/)
})

test('a dangerous title and a sensitive control both fail closed', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  assert.throws(() => gate.record('agent-a', { ...window, title: 'Windows Security' }, elements, helperId), /unsafe/)
  // A control whose own label is sensitive never becomes an actionable target.
  assert.throws(() => gate.record('agent-a', window, [{ ...elements[0], name: 'Send email' }], helperId), /no safely actionable/)
})

test('concurrent operation cannot overwrite a pending observation', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record('agent-a', window, elements, helperId)
  let resolve
  const approval = new Promise(r => { resolve = r })
  const running = run(gate, id, { approve: () => approval })
  assert.throws(() => gate.record('agent-a', window, elements, helperId), /in progress/)
  await assert.rejects(run(gate, id), /in progress/)
  resolve('allowed-once')
  assert.equal(await running, 'delivered')
})
