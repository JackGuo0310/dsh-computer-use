import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Plugin from '../src/plugin.js'

async function loadWith(configLines, { applied = [], stubProvider = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cu-config-'))
  const configPath = join(root, 'cordis.yml')
  const modules = new Map([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['dsh-computer-use-safe-win', {
      ...Plugin,
      inject: ['computerUse', 'tools', 'systemPrompt', 'connection'],
      // The real apply runs unless the provider itself is stubbed, so the
      // volatile config handles and the platform and driver gates are exercised.
      apply: stubProvider
        ? async (ctx, config) => {
          applied.push(Plugin.resolveObservationConfig(config).allowedApps)
          await Plugin.startSafeWinProvider(ctx, {
            // Reads the live handle on every call, exactly as the real apply does.
            readSettings: () => Plugin.resolveObservationConfig(config),
            startRuntime: async () => ({ listTargets: async () => [], observe: async () => ({}), close: async () => {} }),
          })
        }
        : async (ctx, config) => Plugin.apply(ctx, config),
    }],
  ])
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'dsh-computer-use-safe-win'",
    ...configLines,
    '',
  ].join('\n'))
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier) {
      if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
      return modules.get(specifier)
    },
  }
  ctx.provide('computerUse', { register() { return async () => {} } })
  ctx.provide('connection', { fetch: { register() { return () => {} } } })
  try {
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    for (const fiber of ctx.loader.entries()) await fiber.fiber?.await()
    return { ctx, root, loaded: true }
  } catch (error) {
    return { ctx, root, loaded: false, error }
  }
}

test('a string allowlist is refused by the declared Config validator', async () => {
  const result = await loadWith(['  config:', '    enabled: true', '    allowedApps: notepad.exe'])
  try {
    assert.equal(result.loaded, false, 'a non-array allowlist must not load')
    assert.match(String(result.error), /allowlist|allowedApps/i)
  } finally {
    await result.ctx.fiber.dispose()
    await rm(result.root, { recursive: true, force: true })
  }
})

test('Config validation rejects overlong executable names and lists over 64 entries', () => {
  assert.throws(() => Plugin.Config({ enabled: false, allowedApps: ['bad/name.exe'] }), /allowedApps\[0\].*regexp/)
  assert.throws(() => Plugin.Config({ enabled: false, allowedApps: [`${'x'.repeat(129)}.exe`] }), /allowedApps\[0\].*regexp/)
  assert.throws(() => Plugin.Config({ enabled: false, allowedApps: Array.from({ length: 65 }, (_, index) => `app${index}.exe`) }), /allowedApps.*length <= 64/)
})

test('the exported Host config validator rejects cross-field and protected app violations', () => {
  assert.throws(() => Plugin.validateConfig({ enabled: true, allowedApps: [] }), /nonempty executable allowlist/)
  assert.throws(() => Plugin.validateConfig({ enabled: false, allowedApps: ['powershell.exe'] }), /forbidden application/)
  assert.throws(() => Plugin.validateConfig({ enabled: false, allowedApps: ['Notepad.exe', 'notepad.exe'] }), /duplicate/)
})

test('a disabled plugin loads, mounts its tools, and refuses every observation call', async () => {
  // Regression: `enabled` resolves to a Volatile handle, which is always truthy.
  // Reading it directly treated a disabled plugin as enabled and failed the load.
  // The tools stay mounted so that enabling takes effect without a restart.
  const result = await loadWith(['  config:', '    enabled: false', '    allowedApps: []'])
  try {
    assert.equal(result.loaded, true, String(result.error))
    const names = result.ctx.tools.schemas().map(schema => schema.name).sort()
    assert.deepEqual(names, ['safe_win_list_windows', 'safe_win_observe'])
    const listed = await result.ctx.tools.execute({ callId: 'list-1', name: 'safe_win_list_windows', arguments: {}, signal: new AbortController().signal })
    assert.match(JSON.stringify(listed), /observation is disabled/)
  } finally {
    await result.ctx.fiber.dispose()
    await rm(result.root, { recursive: true, force: true })
  }
})

test('volatile config handles are read through get(), not as truthy objects', () => {
  const resolved = Plugin.Config({ enabled: false, allowedApps: ['Notepad.exe'] })
  assert.equal(typeof resolved.enabled.get, 'function', 'this regression only exists while the fields are volatile')
  assert.deepEqual(Plugin.resolveObservationConfig(resolved), { enabled: false, allowedApps: ['Notepad.exe'] })
  assert.deepEqual(Plugin.resolveObservationConfig(Plugin.Config({ enabled: true, allowedApps: [] })), { enabled: true, allowedApps: [] })
  assert.deepEqual(Plugin.resolveObservationConfig(undefined), { enabled: false, allowedApps: [] })
  // Plain values stay supported so the plugin can run outside the settings projection.
  assert.deepEqual(Plugin.resolveObservationConfig({ enabled: true, allowedApps: ['a.exe'] }), { enabled: true, allowedApps: ['a.exe'] })
})

test('a well-formed allowlist loads the two inspection-only tools', async () => {
  const applied = []
  const result = await loadWith(['  config:', '    enabled: true', '    allowedApps: ["notepad.exe"]'], { applied, stubProvider: true })
  try {
    assert.equal(result.loaded, true, String(result.error))
    const names = result.ctx.tools.schemas().map(schema => schema.name)
    assert.ok(names.includes('safe_win_list_windows'))
    assert.ok(names.includes('safe_win_observe'))
    assert.equal(names.includes('safe_win_act'), false)
  } finally {
    await result.ctx.fiber.dispose()
    await rm(result.root, { recursive: true, force: true })
  }
})

test('saving a new allowlist reaches the running provider without a restart', async () => {
  const applied = []
  const result = await loadWith(['  config:', '    enabled: true', '    allowedApps: ["notepad.exe"]'], { applied, stubProvider: true })
  try {
    assert.equal(result.loaded, true, String(result.error))
    assert.deepEqual(applied, [['notepad.exe']])
    const read = () => {
      const entry = result.ctx.loader.entries().find(row => row.options.name === 'dsh-computer-use-safe-win')
      return entry.fiber.config
    }
    assert.deepEqual(Plugin.resolveObservationConfig(read()).allowedApps, ['notepad.exe'])
    const entry = result.ctx.loader.entries().find(row => row.options.name === 'dsh-computer-use-safe-win')
    await entry.update({ config: { enabled: true, allowedApps: ['notepad.exe', 'calc.exe'] } })
    await result.ctx.loader.await()
    for (const row of result.ctx.loader.entries()) await row.fiber?.await()
    // The Loader commits a volatile-only edit in place: no second apply, but the
    // handle the running provider holds now reports the saved list.
    assert.deepEqual(applied, [['notepad.exe']], 'a volatile-only save must not restart the plugin')
    assert.deepEqual(Plugin.resolveObservationConfig(read()).allowedApps, ['notepad.exe', 'calc.exe'])
    const names = result.ctx.tools.schemas().map(schema => schema.name)
    assert.ok(names.includes('safe_win_observe'), 'the observation tools must still be registered after the save')
  } finally {
    await result.ctx.fiber.dispose()
    await rm(result.root, { recursive: true, force: true })
  }
})
