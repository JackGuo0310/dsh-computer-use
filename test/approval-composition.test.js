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

const target = {
  windowId: 4242n, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad',
  bounds: { x: 0, y: 0, width: 900, height: 700 }, isOnScreen: true, minimized: false,
}

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
      apply: async ctx => { await Plugin.startSafeWinProvider(ctx, {
        allowedApps: new Set(['notepad.exe']),
        startRuntime: async () => ({
          async listTargets() { calls.push('list'); return [target] },
          async observe(window, options) {
            calls.push(['observe', window.windowId, options.includeScreenshot])
            return {
              target, snapshotId: 'approval-fixture-snapshot', treeMarkdown: 'Button: Apply', truncated: false, images: [],
              elements: [{ index: 0, role: 'button', label: 'Apply', value: '', enabled: true, selected: false, token: 'private-token', actions: ['click'] }],
            }
          },
          async close() {},
        }),
      }) },
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
  ctx.loader.internal = { version: 'v2', async import(specifier) {
    if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
    return modules.get(specifier)
  } }
  ctx.provide('computerUse', { register() { return async () => {} } })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return {
    ctx, calls,
    run: (name, args) => ctx.tools.execute({ callId: 'call-1', name, arguments: args, signal: new AbortController().signal }),
    cleanup: async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) },
  }
}

test('the real approval service may load but no input action tool is exposed', async () => {
  const { ctx, cleanup } = await boot()
  try {
    assert.equal(typeof ctx.get('approval')?.request, 'function')
    assert.equal(ctx.tools.schemas().some(schema => schema.name === 'safe_win_act'), false)
  } finally { await cleanup() }
})

test('desktop inspection works without an approval decision and cannot deliver input', async () => {
  const { calls, run, cleanup } = await boot()
  try {
    const result = await run('safe_win_observe', { windowId: '4242', pid: 1234, screenshot: false })
    assert.notEqual(result.status, 'error', JSON.stringify(result))
    assert.match(JSON.stringify(result), /Apply/)
    assert.doesNotMatch(JSON.stringify(result), /private-token/)
    assert.equal(calls.some(entry => Array.isArray(entry) && entry[0] === 'click'), false)
  } finally { await cleanup() }
})
