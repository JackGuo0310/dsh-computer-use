import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const adapterPath = fileURLToPath(new URL('../src/cua-adapter.js', import.meta.url))
const policyPath = fileURLToPath(new URL('../src/policy.js', import.meta.url))
const pluginPath = fileURLToPath(new URL('../src/plugin.js', import.meta.url))

test('the Host half waits only for services the profile can actually provide', async () => {
  const plugin = await import('../src/plugin.js')
  // `configForms` is a browser service (@deepseek-ai/dsh-ui-settings) and can never
  // exist in the Host process; declaring it left this plugin pending forever.
  // `computerUse` is optional too: the default web profile does not mount the
  // package that provides it, and the Host plugin manager admits only bundles with
  // a patch file, so requiring it parked the whole Host half on `pending`.
  assert.deepEqual([...plugin.inject].sort(), ['connection'])
  assert.equal(typeof plugin.Config, 'function', 'Config must be the callable Schemastery schema the Host resolves')
  assert.equal(typeof plugin.Config.toJSON, 'function')

  const source = await readFile(pluginPath, 'utf8')
  assert.doesNotMatch(source, /ctx\.configForms/)
  assert.doesNotMatch(source, /\/requirements/, 'the prerequisite state is read from the plugin manager, not from this Host')
  assert.match(source, /register\(PROVIDER\)/, 'the provider must take the exclusive registration whenever the registry exists')
  assert.match(source, /ctx\.get\('computerUse'\)/, 'a missing registry must be detected instead of awaited')
  assert.match(source, /ctx\.inject\(\['computerUse'\]/, 'a registry mounted later must still be adopted')
})

test('the Cua adapter uses only the SDK-managed private worker topology', async () => {
  const source = await readFile(adapterPath, 'utf8')
  assert.match(source, /CuaDriver\.createPrivateWorker/)
  assert.doesNotMatch(source, /CuaDriver\.create\(/)
  assert.doesNotMatch(source, /callTool\s*\(/)
})

test('the adapter delivers input only in the background, and only at element or window-bounded coordinates', async () => {
  const source = await readFile(adapterPath, 'utf8')
  // Foreground delivery and desktop-wide targets are the two ways an action
  // could escape the window the person approved; neither may appear.
  assert.match(source, /deliveryMode: InputDeliveryMode\.Background/)
  assert.doesNotMatch(source, /InputDeliveryMode\.Foreground/)
  assert.doesNotMatch(source, /ActionTarget\.Desktop/)
  // Both position forms are window-relative and must name their window as the
  // target: an element token, or a point this adapter bounds-checks itself.
  assert.match(source, /new ClickPosition\.Element\(/)
  assert.match(source, /new ClickPosition\.Coordinates\(/)
  assert.match(source, /is outside the window/)
  assert.match(source, /new ActionTarget\.Window\(/)
  // The adapter still implements typing and key presses, but no registered tool
  // may reach them: they need focus that background delivery cannot give, and
  // the live run showed background text never lands. That invariant is asserted
  // against the plugin below, where the tool surface lives.
})

test('the plugin exposes listing, observation, and an opt-in pixel click', async () => {
  const source = await readFile(pluginPath, 'utf8')
  assert.match(source, /safe_win_list_windows/)
  assert.match(source, /safe_win_observe/)
  assert.match(source, /safe_win_click_at/)
  assert.doesNotMatch(source, /safe_win_act/)
  assert.doesNotMatch(source, /safe_win_inspect/)
  // No registered tool may reach the typing or key-press entry points: those
  // need foreground focus, and the live run showed background text never lands.
  assert.doesNotMatch(source, /\.typeText\(/)
  assert.doesNotMatch(source, /\.pressKey\(/)
  // The pixel path is off by default and budgeted per session.
  assert.match(source, /coordinate clicks are disabled in the computer-use plugin settings/)
  assert.match(source, /already spent its budget/)
})

test('policy requires opaque bigint identity and performs window allowlist checks', async () => {
  const source = await readFile(policyPath, 'utf8')
  assert.match(source, /typeof window\.windowId !== 'bigint'/)
  assert.match(source, /allowedApps\.matches\(/)
})
