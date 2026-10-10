import test from 'node:test'
import assert from 'node:assert/strict'
import { configuredApps, identityFromApp, executablePath } from '../src/policy.js'

const NPAD_PATH = 'C:\\Program Files\\WindowsApps\\Notepad\\Notepad.exe'

test('a path entry matches only that exact path', () => {
  const allowlist = configuredApps([NPAD_PATH])
  assert.equal(allowlist.matches({ name: 'notepad.exe', path: NPAD_PATH.toLowerCase() }), true)
  assert.equal(allowlist.matches({ name: 'notepad.exe', path: 'C:\\Other\\notepad.exe' }), false)
  // An app the driver gave no path for can never satisfy a path entry.
  assert.equal(allowlist.matches({ name: 'notepad.exe' }), false)
})

test('a filename entry matches the executable filename and needs no path', () => {
  const allowlist = configuredApps(['notepad.exe'])
  assert.equal(allowlist.matches({ name: 'notepad.exe' }), true)
  assert.equal(allowlist.matches({ name: 'notepad.exe', path: 'C:\\Anywhere\\notepad.exe' }), true)
  assert.equal(allowlist.matches({ name: 'other.exe', path: 'C:\\Anywhere\\other.exe' }), false)
})

test('entries are normalized and never match the other form', () => {
  const allowlist = configuredApps(['C:/Program Files/App/app.exe'])
  assert.deepEqual([...allowlist], ['c:\\program files\\app\\app.exe'])
  assert.equal(allowlist.has('app.exe'), false, 'a path entry must not admit the bare filename')
  assert.equal(allowlist.matches({ name: 'app.exe', path: 'c:\\program files\\app\\app.exe' }), true)
})

test('relative paths and parent traversal are refused', () => {
  // A bare `app.exe` is a valid filename entry; the relative and traversing forms
  // are not, because they do not name one absolute executable.
  for (const entry of ['.\\app.exe', 'Program Files\\App\\app.exe', 'C:\\..\\Windows\\app.exe', 'C:\\Windows\\..\\app.exe', '/usr/bin/app.exe', 'C:\\Windows\\app.exe.txt', 'C:app.exe']) {
    assert.throws(() => configuredApps([entry]), /invalid executable name/, entry)
  }
  assert.equal(executablePath('C:\\a\\..\\b.exe'), undefined)
})

test('protected executables are refused by path as well as by filename', () => {
  assert.throws(() => configuredApps(['C:\\Windows\\System32\\cmd.exe']), /forbidden application/)
  assert.throws(() => configuredApps(['C:\\Program Files\\PowerShell\\7\\pwsh.exe']), /forbidden application/)
})

test('identityFromApp reports the path only when the driver supplied one', () => {
  assert.deepEqual(identityFromApp({ name: 'notepad.exe' }), { name: 'notepad.exe' })
  assert.deepEqual(identityFromApp({ name: 'calc.exe', launchPath: 'C:\\Windows\\System32\\calc.exe' }), { name: 'calc.exe', path: 'c:\\windows\\system32\\calc.exe' })
  // Disagreement between the two fields stays unresolved.
  assert.equal(identityFromApp({ name: 'a.exe', launchPath: 'C:\\x\\b.exe' }), undefined)
  assert.equal(identityFromApp({}), undefined)
})