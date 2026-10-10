import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAllowedApps } from '../src/config-policy.js'
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
})
