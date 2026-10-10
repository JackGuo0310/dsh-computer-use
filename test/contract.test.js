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

test('the adapter can deliver input only as a background element click', async () => {
  const source = await readFile(adapterPath, 'utf8')
  // Foreground delivery and raw coordinates are the two ways an action could
  // escape the window the user approved, so neither may appear in the adapter.
  assert.match(source, /deliveryMode: InputDeliveryMode\.Background/)
  assert.doesNotMatch(source, /InputDeliveryMode\.Foreground/)
  assert.match(source, /new ClickPosition\.Element\(/)
  assert.doesNotMatch(source, /ClickPosition\.Coordinates/)
  assert.doesNotMatch(source, /ActionTarget\.Desktop/)
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
