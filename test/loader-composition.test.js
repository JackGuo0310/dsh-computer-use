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

const target = {
  windowId: 4242n, pid: 1234, app: 'notepad.exe', title: 'Untitled - Notepad',
  bounds: { x: 0, y: 0, width: 900, height: 700 }, isOnScreen: true, minimized: false,
}
const snapshot = {
  target, snapshotId: 'fixture-snapshot-0001', treeMarkdown: 'Button: Save', truncated: false,
  elements: [{ index: 0, role: 'button', label: 'Save', value: '', enabled: true, selected: false, token: 'secret-token', actions: ['click'] }],
  images: [],
}

async function boot({ allowedApps = ['notepad.exe'], runtimeFactory } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cua-'))
  const configPath = join(root, 'cordis.yml')
  let runtime
  const modules = new Map([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['dsh-computer-use-safe-win', {
      ...Plugin,
      inject: ['computerUse', 'tools', 'systemPrompt'],
      apply: async ctx => { await Plugin.startSafeWinProvider(ctx, {
        allowedApps: new Set(allowedApps),
        startRuntime: async signal => {
          signal.throwIfAborted()
          runtime = runtimeFactory ? await runtimeFactory() : {
            async listTargets(apps) { assert.ok(apps.has('notepad.exe')); return [target] },
            async observe() { return snapshot },
            async close() {},
          }
          return runtime
        },
      }) },
    }],
  ])
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'dsh-computer-use-safe-win'",
    '  config:',
    '    enabled: true',
    `    allowedApps: ${JSON.stringify(allowedApps)}`,
    '',
  ].join('\n'))
  const registrations = []
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier) {
    if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
    return modules.get(specifier)
  } }
  ctx.provide('computerUse', { register(name) {
    if (registrations.length) throw new Error('computer use slot already taken')
    registrations.push(name)
    return async () => { registrations.pop() }
  } })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  return { ctx, runtime: () => runtime, registrations, cleanup: async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) } }
}

test('the real Loader exposes only two inspection tools and guidance', async () => {
  const { ctx, registrations, cleanup } = await boot()
  try {
    assert.deepEqual(registrations, ['safe-win'])
    const names = ctx.tools.schemas().map(schema => schema.name)
    assert.deepEqual(names.sort(), ['safe_win_list_windows', 'safe_win_observe'])
    const assembled = await ctx.systemPrompt.assemble({})
    const prompt = assembled.sections.map(section => section.text).join('\n')
    assert.match(prompt, /no desktop input actions/)
    assert.match(prompt, /untrusted data/)
    assert.deepEqual(assembled.tools.map(tool => tool.name).sort(), names.sort())
  } finally { await cleanup() }
})

test('unloading through the Loader releases the provider slot', async () => {
  const { registrations, cleanup } = await boot()
  await cleanup()
  assert.deepEqual(registrations, [])
})

test('empty and forbidden allowlists are rejected before load', async () => {
  await assert.rejects(boot({ allowedApps: [] }), /allowlist/)
  await assert.rejects(boot({ allowedApps: ['powershell.exe'] }), /forbidden application/)
})

test('the real tool registry lists and observes only the selected Cua window', async () => {
  const calls = []
  const { ctx, cleanup } = await boot({ runtimeFactory: async () => ({
    async listTargets(apps) { calls.push(['list', [...apps]]); return [target] },
    async observe(window, options) { calls.push(['observe', window.windowId, options.includeScreenshot]); return snapshot },
    async close() {},
  }) })
  try {
    const listed = await ctx.tools.execute({ callId: 'list-1', name: 'safe_win_list_windows', arguments: {}, signal: new AbortController().signal })
    assert.notEqual(listed.status, 'error', JSON.stringify(listed))
    assert.match(JSON.stringify(listed), /4242/)
    const observed = await ctx.tools.execute({ callId: 'observe-1', name: 'safe_win_observe', arguments: { windowId: '4242', pid: 1234, screenshot: false }, signal: new AbortController().signal })
    assert.notEqual(observed.status, 'error', JSON.stringify(observed))
    assert.match(JSON.stringify(observed), /Save/)
    assert.doesNotMatch(JSON.stringify(observed), /secret-token/)
    assert.deepEqual(calls, [['list', ['notepad.exe']], ['list', ['notepad.exe']], ['observe', 4242n, false]])
  } finally { await cleanup() }
})
