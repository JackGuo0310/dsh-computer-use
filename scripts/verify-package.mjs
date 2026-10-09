/**
 * Verifies the published package the way a profile installs it: pack a tarball,
 * install it into a scratch directory, then load it by name through the real
 * Loader with the real tools and systemPrompt services.
 *
 * This cannot live in the default test run because it needs npm pack/install and
 * a scratch tree. It performs no desktop operation: the helper is stubbed, so the
 * plugin's process boundary is the only thing left untested here.
 *
 * Usage: node scripts/verify-package.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

const workspace = fileURLToPath(new URL('..', import.meta.url))
// npm's CLI is invoked in-process: the sandbox rejects a child that captures
// stdio, and the npm.cmd shim cannot be spawned without a shell.
const npmCli = process.env.npm_execpath
  ?? join(process.env.APPDATA ?? join(homedir(), '.npm'), 'npm/node_modules/npm/bin/npm-cli.js')
const run = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8' })

async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-cu-package-'))
  try {
    const packDir = join(scratch, 'pack')
    await mkdir(packDir, { recursive: true })
    const packed = run(['pack', '--pack-destination', packDir], workspace).trim().split('\n').pop()
    console.log(`packed ${packed}`)

    const installDir = join(scratch, 'install')
    await mkdir(installDir, { recursive: true })
    await writeFile(join(installDir, 'package.json'), JSON.stringify({ name: 'scratch', private: true }))
    run(['install', join(packDir, packed)], installDir)
    console.log('installed into a scratch tree')

    const require = createRequire(join(installDir, 'noop.js'))
    const entry = require.resolve('dsh-computer-use-safe-win')
    const packageRoot = join(dirname(entry), '..')
    console.log(`resolved entry ${entry}`)

    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh?.bundle, { patch: 'cordis.patch.yml' }, 'the package must declare a bundle patch')

    for (const file of ['ComputerUse.Helper.dll', 'ComputerUse.Helper.exe', 'ComputerUse.Helper.runtimeconfig.json']) {
      assert.ok(existsSync(join(packageRoot, 'native', 'publish', file)), `${file} is missing from the tarball`)
    }
    console.log('helper runtime is present in the tarball')

    const patch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /name: dsh-computer-use-safe-win/)
    assert.match(patch, /allowedApps: \[\]/, 'the shipped allowlist must stay empty so the load fails closed')
    console.log('bundle patch names the package and ships no default allowlist')

    const plugin = await import(pathToFileURL(entry).href)
    assert.equal(plugin.name, 'computer-use-safe-win')

    const configRoot = await mkdtemp(join(tmpdir(), 'dsh-cu-config-'))
    const configPath = join(configRoot, 'cordis.yml')
    const modules = new Map([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['dsh-computer-use-safe-win', {
        ...plugin,
        // Stub only the process boundary; everything above it is the shipped module.
        apply: async ctx => {
          await plugin.startSafeWinProvider(ctx, {
            allowedApps: new Set(['notepad.exe']),
            startHelper: async () => ({ call: async () => { throw new Error('helper stubbed') }, close: async () => {} }),
          })
        },
      }],
    ])
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: 'dsh-computer-use-safe-win'",
      '  config:',
      '    allowedApps: ["notepad.exe"]',
      '',
    ].join('\n'))

    const registrations = []
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(configRoot).href + '/'
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
      register(name) { registrations.push(name); return async () => { registrations.pop() } },
    })
    try {
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      for (const fiber of ctx.loader.entries()) await fiber.fiber?.await()
      const names = ctx.tools.schemas().map(schema => schema.name)
      for (const expected of ['safe_win_inspect', 'safe_win_observe', 'safe_win_act']) {
        assert.ok(names.includes(expected), `${expected} is not model-visible after installing the tarball`)
      }
      assert.deepEqual(registrations, ['safe-win'])
      console.log('the installed package loads through the Loader and exposes all three tools')

      await ctx.fiber.dispose()
      assert.deepEqual(registrations, [], 'unload must release the provider slot')
      console.log('unload released the provider slot')
    } finally {
      await ctx.fiber.dispose()
      await rm(configRoot, { recursive: true, force: true })
    }
    console.log('\npackage verification passed')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()