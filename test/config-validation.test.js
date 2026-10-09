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

async function loadWith(configLines) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cu-config-'))
  const configPath = join(root, 'cordis.yml')
  const modules = new Map([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['dsh-computer-use-safe-win', {
      ...Plugin,
      inject: ['computerUse', 'tools', 'systemPrompt'],
      apply: async ctx => { await Plugin.startSafeWinProvider(ctx, {
        allowedApps: new Set(['notepad.exe']),
        startRuntime: async () => ({ listTargets: async () => [], observe: async () => ({}), close: async () => {} }),
      }) },
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

test('a well-formed allowlist loads the two inspection-only tools', async () => {
  const result = await loadWith(['  config:', '    enabled: true', '    allowedApps: ["notepad.exe"]'])
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
