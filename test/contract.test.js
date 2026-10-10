import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const adapterPath = fileURLToPath(new URL('../src/cua-adapter.js', import.meta.url))
const policyPath = fileURLToPath(new URL('../src/policy.js', import.meta.url))
const pluginPath = fileURLToPath(new URL('../src/plugin.js', import.meta.url))

test('the Cua adapter uses only the SDK-managed private worker topology', async () => {
  const source = await readFile(adapterPath, 'utf8')
  assert.match(source, /CuaDriver\.createPrivateWorker/)
  assert.doesNotMatch(source, /CuaDriver\.create\(/)
  assert.doesNotMatch(source, /callTool\s*\(/)
})

test('the adapter resolves allowlisted executables through the shared policy', async () => {
  const source = await readFile(adapterPath, 'utf8')
  assert.match(source, /executableFromLaunchPath/)
  assert.doesNotMatch(source, /\\\\\.exe/)
})

test('the plugin exposes only curated listing and observation tools', async () => {
  const source = await readFile(pluginPath, 'utf8')
  assert.match(source, /safe_win_list_windows/)
  assert.match(source, /safe_win_observe/)
  assert.doesNotMatch(source, /safe_win_act/)
  assert.doesNotMatch(source, /safe_win_inspect/)
})

test('policy requires opaque bigint identity and performs window allowlist checks', async () => {
  const source = await readFile(policyPath, 'utf8')
  assert.match(source, /typeof window\.windowId !== 'bigint'/)
  assert.match(source, /allowedApps\.has\(app\)/)
})
