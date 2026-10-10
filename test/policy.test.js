import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredApps, executableFromLaunchPath, executableName, identityFromApp, validateWindow } from '../src/policy.js'

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
  assert.deepEqual([...configuredApps(['Fixture.exe'])], ['fixture.exe'])
  // An allowlist is a set, so two entries differing only in case are a mistake.
  assert.throws(() => configuredApps(['Fixture.exe', 'fixture.EXE']), /duplicate/)
  // A path entry and the filename that ends it are two different entries.
  assert.equal(configuredApps(['C:\\App\\fixture.exe', 'fixture.exe']).entries.length, 2)
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

test('a real Windows launch path yields its executable filename', () => {
  // Regression: the adapter once compared basenames against a regex written with
  // doubled escapes, whose character class accepted only `\`, `w`, `.` and `-`.
  // Every real application was then filtered out, so listing returned nothing.
  assert.equal(executableFromLaunchPath('C:\\Windows\\System32\\notepad.exe'), 'notepad.exe')
  assert.equal(executableFromLaunchPath('C:/Program Files/App/some-app.exe'), 'some-app.exe')
  assert.equal(executableFromLaunchPath('C:\\Apps\\Fixture.EXE'), 'fixture.exe')
})

test('an unusable launch path yields no filename instead of a partial match', () => {
  for (const path of ['notepad.exe', 'C:\\Windows\\System32\\notepad', 'C:\\Windows\\.exe', '', 42, undefined, null]) {
    assert.equal(executableFromLaunchPath(path), undefined, String(path))
  }
})

test('one executable-name definition serves both the allowlist and the adapter', () => {
  assert.equal(executableName('Notepad.EXE'), 'notepad.exe')
  assert.equal(executableName('notes.txt'), undefined)
  assert.equal(executableName('C:\\Windows\\notepad.exe'), undefined, 'a path is not a filename')
})

test('an app with no launch path still resolves through its reported name', () => {
  // Observed live: Notepad on Windows 11 is listed with `name` only, no launchPath.
  assert.deepEqual(identityFromApp({ pid: 1, name: 'Notepad.exe', running: true, kind: 'desktop' }), { name: 'notepad.exe' })
  assert.deepEqual(identityFromApp({ pid: 1, name: 'Notepad.exe', launchPath: 'C:\\Windows\\System32\\notepad.exe' }), { name: 'notepad.exe', path: 'c:\\windows\\system32\\notepad.exe' })
  assert.equal(identityFromApp({ pid: 1, name: 'Safari', launchPath: '/Applications/Safari.app/Contents/MacOS/Safari' }), undefined)
  assert.equal(identityFromApp({ pid: 1, name: 'Notepad' }), undefined, 'a display name is not an executable filename')
  assert.equal(identityFromApp(undefined), undefined)
})

test('an app whose name and launch path disagree is refused, not resolved', () => {
  // Accepting either field would make the allowlist decision depend on which one won.
  assert.equal(identityFromApp({ pid: 1, name: 'notepad.exe', launchPath: 'C:\\other\\calc.exe' }), undefined)
  assert.equal(identityFromApp({ pid: 1, name: 'calc.exe', launchPath: 'C:\\Windows\\notepad.exe' }), undefined)
})
