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
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import * as Plugin from '../src/plugin.js'

const window = { hwnd: 4242, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad' }
const elements = [{ type: 'Button', name: 'Apply', automationId: 'apply', password: false, patterns: ['Invoke'] }]

/**
 * Boots the plugin through the real Loader together with the real approval
 * service, so the outcome vocabulary and the missing-answerer path come from the
 * service rather than a stub. The helper is replaced by a recorder; no process is
 * started and no desktop is touched.
 */
async function boot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cu-approval-'))
  const configPath = join(root, 'cordis.yml')
  const calls = []
  const modules = new Map([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-user-approval', ApprovalService],
    ['dsh-computer-use-safe-win', {
      ...Plugin,
      apply: async ctx => {
        await Plugin.startSafeWinProvider(ctx, {
          allowedApps: new Set(['notepad.exe']),
          startHelper: async () => ({
            call: async (method, parameters) => {
              calls.push({ method, parameters })
              if (method === 'inspect') return { ...window }
              if (method === 'observe') return { window, observationId: 'a'.repeat(32), elements }
              throw new Error(`unexpected ${method}`)
            },
            close: async () => {},
          }),
        })
      },
    }],
  ])
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-user-approval'",
    "- name: 'dsh-computer-use-safe-win'",
    '  config:',
    '    allowedApps: ["notepad.exe"]',
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
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const fiber of ctx.loader.entries()) await fiber.fiber?.await()
  return {
    ctx,
    calls,
    run: (name, args) => ctx.tools.execute({
      callId: 'call-1',
      name,
      arguments: args,
      // A real approval request needs a live agent; without one the request cannot
      // be made, which is exactly the fail-closed path under test.
      signal: new AbortController().signal,
    }),
    cleanup: async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

test('the real approval service loads beside the plugin', async () => {
  const { ctx, cleanup } = await boot()
  try {
    assert.equal(typeof ctx.get('approval')?.request, 'function')
  } finally { await cleanup() }
})

test('without a live agent the action fails closed and never reaches invoke', async () => {
  const { calls, run, cleanup } = await boot()
  try {
    const observed = await run('safe_win_observe', { hwnd: 4242 })
    assert.equal(observed.isError, false)
    const result = await run('safe_win_act', { observationId: observed.value.observationId, index: 0, action: 'Invoke' })
    assert.equal(result.isError, true)
    assert.equal(calls.some(entry => entry.method === 'invoke'), false, 'no action may be delivered without an approval decision')
  } finally { await cleanup() }
})

test('the observation the model receives is the filtered one', async () => {
  const { run, cleanup } = await boot()
  try {
    const observed = await run('safe_win_observe', { hwnd: 4242 })
    assert.equal(observed.isError, false)
    // The model sees the filtered view with its own indices, not helper indices.
    assert.deepEqual(observed.value.elements.map(element => element.name), ['Apply'])
    assert.deepEqual(observed.value.elements.map(element => element.index), [0])
    assert.equal(typeof observed.value.observationId, 'string')
  } finally { await cleanup() }
})