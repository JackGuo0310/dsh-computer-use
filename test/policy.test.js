import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredApps, validateWindow } from '../src/policy.js'

const valid = () => ({
  pid: 101,
  windowId: 987654321012345678n,
  app: 'Fixture.EXE',
  title: 'Fixture Document',
  bounds: { x: 10, y: 20, width: 640, height: 480 },
  isOnScreen: true,
  minimized: false,
})

test('requires a nonempty explicit app allowlist and rejects protected executables', () => {
  assert.throws(() => configuredApps(undefined), /nonempty/)
  assert.throws(() => configuredApps([]), /nonempty/)
  assert.throws(() => configuredApps(['powershell.exe']), /forbidden/)
  assert.throws(() => configuredApps(['dsh-agent.exe']), /forbidden/)
  assert.deepEqual([...configuredApps(['Fixture.exe', 'fixture.EXE'])], ['fixture.exe'])
})

test('validates allowlisted window and preserves bigint identity exactly', () => {
  const identity = validateWindow(valid(), configuredApps(['fixture.exe']))
  assert.equal(identity.windowId, 987654321012345678n)
  assert.equal(identity.app, 'fixture.exe')
  assert.ok(Object.isFrozen(identity))
  assert.ok(Object.isFrozen(identity.bounds))
})

test('rejects non-bigint, zero, and malformed window identities', () => {
  for (const id of [987654321012345678, '987654321012345678', 0n, -1n, null]) {
    assert.throws(() => validateWindow({ ...valid(), windowId: id }, configuredApps(['fixture.exe'])), /window identity/)
  }
})

test('rejects disallowed, forbidden, dangerous, or malformed windows', () => {
  const allowed = configuredApps(['fixture.exe'])
  for (const window of [
    { ...valid(), app: 'other.exe' },
    { ...valid(), app: 'powershell.exe' },
    { ...valid(), title: 'Password prompt' },
    { ...valid(), title: 'Fixture - Security settings' },
    { ...valid(), title: '   ' },
    { ...valid(), title: 'x'.repeat(513) },
    { ...valid(), pid: 0 },
    { ...valid(), bounds: { x: 0, y: 0, width: 0, height: 20 } },
    { ...valid(), isOnScreen: false },
    { ...valid(), minimized: true },
  ]) assert.throws(() => validateWindow(window, allowed))
})

test('window validation does not mutate supplied Cua data', () => {
  const window = valid()
  const originalBounds = { ...window.bounds }
  const identity = validateWindow(window, configuredApps(['fixture.exe']))
  assert.deepEqual(window.bounds, originalBounds)
  assert.notEqual(identity.bounds, window.bounds)
})
