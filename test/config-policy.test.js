import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAllowedApps, validateAllowedApps } from '../src/config-policy.js'
import { validateSettingsDraft } from '../src/settings-validation.js'

test('allowlist editor normalizes common separators and executable casing', () => {
  assert.deepEqual(normalizeAllowedApps(' Notepad.EXE\ncalc.exe; paint.exe '), ['notepad.exe', 'calc.exe', 'paint.exe'])
})

test('allowlist editor accepts blank while disabled but rejects it for enabled drafts', () => {
  assert.deepEqual(validateSettingsDraft({ enabled: false, allowedApps: normalizeAllowedApps('') }).value, { enabled: false, allowedApps: [] })
  assert.match(validateSettingsDraft({ enabled: true, allowedApps: [] }).issues[0].message, /nonempty executable allowlist/)
})

test('allowlist editor refuses unsafe names, malformed input, and oversized lists', () => {
  assert.throws(() => normalizeAllowedApps('powershell.exe'), /forbidden application/)
  assert.throws(() => normalizeAllowedApps('notepad'), /invalid executable name/)
  assert.throws(() => normalizeAllowedApps(Array.from({ length: 65 }, (_, index) => `app${index}.exe`).join('\n')), /64 applications/)
  assert.throws(() => normalizeAllowedApps('notepad.exe\nNOTEPAD.EXE'), /duplicate/)
  assert.throws(() => normalizeAllowedApps(42), /must be text/)
  assert.deepEqual(validateAllowedApps([]), [])
  assert.throws(() => validateAllowedApps(['notepad.exe', 7]), /executable names/)
})

test('Host draft validation enforces normalized allowlist rules independently of the client', () => {
  assert.deepEqual(validateSettingsDraft({ enabled: false, allowedApps: ['Notepad.exe'] }).value, { enabled: false, allowedApps: ['notepad.exe'] })
  assert.match(validateSettingsDraft({ enabled: false, allowedApps: ['notepad.exe', 'NOTEPAD.EXE'] }).issues[0].message, /duplicate/)
  assert.match(validateSettingsDraft({ enabled: false, allowedApps: Array.from({ length: 65 }, (_, index) => `app${index}.exe`) }).issues[0].message, /64 applications/)
  assert.deepEqual(validateSettingsDraft({ enabled: false, allowedApps: [] }).value, { enabled: false, allowedApps: [] })
})
