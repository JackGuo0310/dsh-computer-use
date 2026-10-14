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

test('the adapter confines every action to the named window and rejects unknown delivery', async () => {
  const source = await readFile(adapterPath, 'utf8')
  // A desktop-wide target is the one way an action can leave the window the
  // person approved; it must never appear, in either delivery mode.
  assert.doesNotMatch(source, /ActionTarget\.Desktop/)
  assert.match(source, /new ActionTarget\.Window\(/)
  // Background stays the default; foreground is reachable only by naming it, and
  // anything else is refused rather than silently treated as background.
  assert.match(source, /deliveryEnum\(delivery\)/)
  assert.match(source, /unknown delivery mode/)
  assert.match(source, /delivery = DELIVERY\.background/)
  // Both position forms stay window-relative: an element token, or a point this
  // adapter bounds-checks against a freshly read window.
  assert.match(source, /new ClickPosition\.Element\(/)
  assert.match(source, /new ClickPosition\.Coordinates\(/)
  assert.match(source, /is outside the window/)
})

test('the plugin exposes listing, observation, and three opt-in actions', async () => {
  const source = await readFile(pluginPath, 'utf8')
  assert.match(source, /safe_win_list_windows/)
  assert.match(source, /safe_win_observe/)
  assert.match(source, /safe_win_click_at/)
  assert.match(source, /safe_win_type_text/)
  assert.match(source, /safe_win_press_key/)
  assert.doesNotMatch(source, /safe_win_act/)
  assert.doesNotMatch(source, /safe_win_inspect/)
  // Every action is gated by its own switch, and each refusal names the setting
  // so a caller is told which switch to turn on rather than only that it failed.
  assert.ok(source.includes('allowCoordinateClicks'), 'the pixel path reads its own switch')
  assert.match(source, /coordinate clicks are disabled in the computer-use plugin settings/)
  assert.ok(source.includes('allowTextInput'), 'typing reads its own switch')
  assert.match(source, /requireEnabled\('allowTextInput', 'text input'\)/)
  // Foreground delivery is never implied: it needs its own switch, and the
  // result names which delivery actually ran.
  assert.match(source, /allowForegroundActions === true \? DELIVERY\.foreground : DELIVERY\.background/)
  assert.match(source, /requestedDelivery: delivery/)
  // Both budgets are spent, never reset, and never retried.
  assert.match(source, /already spent its budget/)
  assert.match(source, /would exceed this session's budget/)
})

test('policy requires opaque bigint identity and performs window allowlist checks', async () => {
  const source = await readFile(policyPath, 'utf8')
  assert.match(source, /typeof window\.windowId !== 'bigint'/)
  assert.match(source, /allowedApps\.matches\(/)
})
