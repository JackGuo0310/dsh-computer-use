import test from 'node:test'
import assert from 'node:assert/strict'
import { ObservationGate, configuredApps } from '../src/policy.js'

const window = { hwnd: 100, pid: 22, app: 'fixture.exe', title: 'Fixture' }
const elements = [{ type: 'Button', name: 'Next', automationId: 'next', password: false, patterns: ['Invoke'] }]
const helperId = '0123456789abcdef0123456789abcdef'
const run = (gate, id, options = {}) => gate.execute({ observationId: id, index: 0, action: 'Invoke', currentWindow: async () => window, approve: async () => 'allowed-once', deliver: async () => 'delivered', ...options })

test('requires a nonempty explicit app allowlist and rejects protected executables', () => {
  assert.throws(() => configuredApps([]), /allowlist/)
  assert.throws(() => configuredApps(['powershell.exe']), /forbidden/)
  assert.throws(() => configuredApps(['dsh.exe']), /forbidden/)
})

test('approval precedes revalidation and delivery; observation is consumed', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const observed = gate.record(window, elements, helperId)
  const events = []
  assert.equal(await run(gate, observed.observationId, { approve: async () => { events.push('approve'); return 'allowed-once' }, currentWindow: async () => { events.push('check'); return window }, deliver: async () => { events.push('deliver'); return 'done' } }), 'done')
  assert.deepEqual(events, ['approve', 'check', 'deliver'])
  await assert.rejects(run(gate, observed.observationId), /stale observation/)
})

test('approval refusal never delivers, and does not allow retry', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record(window, elements, helperId)
  await assert.rejects(run(gate, id, { approve: async () => 'unavailable', deliver: () => { throw Error('delivered') } }), /not approved/)
  await assert.rejects(run(gate, id), /stale/)
})

test('window changes after approval fail closed', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record(window, elements, helperId)
  await assert.rejects(run(gate, id, { currentWindow: async () => ({ ...window, pid: 33 }), deliver: () => { throw Error('delivered') } }), /window changed/)
})

test('sensitive buttons and dangerous titles cannot be selected', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  assert.throws(() => gate.record({ ...window, title: 'Security Settings' }, elements, helperId), /unsafe/)
  const { observationId: id } = gate.record(window, [{ ...elements[0], name: 'Send' }], helperId)
  await assert.rejects(run(gate, id), /sensitive/)
})

test('concurrent operation cannot overwrite a pending observation', async () => {
  const gate = new ObservationGate(['fixture.exe'])
  const { observationId: id } = gate.record(window, elements, helperId)
  let resolve
  const approval = new Promise(r => { resolve = r })
  const running = run(gate, id, { approve: () => approval })
  assert.throws(() => gate.record(window, elements, helperId), /in progress/)
  await assert.rejects(run(gate, id), /in progress/)
  resolve('allowed-once')
  assert.equal(await running, 'delivered')
})
