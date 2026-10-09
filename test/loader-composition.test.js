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

/**
 * Boots the plugin through the real Loader with the real tools and systemPrompt
 * services. A hand-built Context cannot catch a loader-visible composition fault,
 * so this file exists to prove the plugin composes the way a profile loads it.
 *
 * Only the computer-use registry and the helper are stubbed: the registry package
 * is not published locally, and the helper must never touch the desktop here.
 * @param options - allowlist entries and the stub helper behaviour.
 * @returns the live context plus release bookkeeping.
 */
async function boot({ allowedApps = ['notepad.exe'], helperCall } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-safe-win-'))
  const configPath = join(root, 'cordis.yml')
  const modules = new Map([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['dsh-computer-use-safe-win', {
      ...Plugin,
      // apply() must resolve to undefined; a returned object is an invalid effect.
      apply: async ctx => {
        await Plugin.startSafeWinProvider(ctx, {
          allowedApps: new Set(allowedApps),
          startHelper: async () => ({
            call: helperCall ?? (async () => { throw new Error('the helper must not be called in a composition test') }),
            close: async () => {},
          }),
        })
      },
    }],
  ])
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'dsh-computer-use-safe-win'",
    '  config:',
    `    allowedApps: ${JSON.stringify(allowedApps)}`,
    '',
  ].join('\n'))

  const registrations = []
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
  ctx.provide('computerUse', {
    register(name) {
      if (registrations.length) throw new Error('computer use slot already taken')
      registrations.push(name)
      return async () => { registrations.pop() }
    },
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return { ctx, root, registrations, cleanup: async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) } }
}

test('the Loader exposes all three gated tools and the prompt section', async () => {
  const { ctx, registrations, cleanup } = await boot()
  try {
    assert.deepEqual(registrations, ['safe-win'])
    const names = ctx.tools.schemas().map(schema => schema.name)
    for (const expected of ['safe_win_inspect', 'safe_win_observe', 'safe_win_act']) {
      assert.ok(names.includes(expected), `${expected} is not visible to the model; saw ${names.join(', ')}`)
    }
    const assembled = await ctx.systemPrompt.assemble({})
    const prompt = assembled.sections.map(section => section.text).join('\n')
    // The section carries behaviour rules; the tool names travel in their own list.
    assert.match(prompt, /one-time user approval/)
    assert.match(prompt, /untrusted data/)
    const namesInPrompt = assembled.tools.map(tool => tool.name)
    for (const expected of ['safe_win_inspect', 'safe_win_observe', 'safe_win_act']) {
      assert.ok(namesInPrompt.includes(expected), `${expected} is not advertised with the section`)
    }
  } finally { await cleanup() }
})

test('unloading through the Loader releases the slot', async () => {
  const { registrations, cleanup } = await boot()
  await cleanup()
  assert.deepEqual(registrations, [])
})

test('an empty allowlist fails the load instead of exposing the tools', async () => {
  await assert.rejects(boot({ allowedApps: [] }), /allowedApps/)
})

test('a forbidden allowlist entry fails the load', async () => {
  await assert.rejects(boot({ allowedApps: ['powershell.exe'] }), /forbidden application/)
})

test('a tool call reaches the stub helper through the real registry', async () => {
  const calls = []
  const { ctx, cleanup } = await boot({
    helperCall: async (method, parameters) => {
      calls.push({ method, parameters })
      if (method === 'inspect') return { hwnd: 4242, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad' }
      throw new Error(`unexpected method ${method}`)
    },
  })
  try {
    const result = await ctx.tools.execute({
      callId: 'compose-1',
      name: 'safe_win_inspect',
      arguments: { hwnd: 4242 },
      signal: new AbortController().signal,
    })
    assert.equal(result.isError, false)
    assert.deepEqual(calls, [{ method: 'inspect', parameters: { hwnd: 4242 } }])
  } finally { await cleanup() }
})