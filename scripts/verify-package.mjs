import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

const workspace = fileURLToPath(new URL('..', import.meta.url))
const npmCli = process.env.npm_execpath
  ?? join(process.env.APPDATA ?? join(homedir(), '.npm'), 'npm/node_modules/npm/bin/npm-cli.js')
const run = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8' })

async function main() {
  const scratch = await mkdtemp(join(workspace, '.verify-package-'))
  try {
    const tarballName = run(['pack', '--json'], workspace).trim()
    const tarballInfo = JSON.parse(tarballName)['dsh-computer-use-safe-win']
    assert.equal(tarballInfo?.version, '0.1.0')
    const tarball = join(workspace, tarballInfo.filename)
    const installDir = join(scratch, 'install')
    await mkdir(installDir)
    await writeFile(join(installDir, 'package.json'), JSON.stringify({ private: true, dependencies: { 'dsh-computer-use-safe-win': `file:${tarball}` } }))
    run(['install', '--ignore-scripts', '--no-audit', '--no-fund'], installDir)
    const require = createRequire(join(installDir, 'noop.js'))
    const entry = require.resolve('dsh-computer-use-safe-win')
    const packageRoot = join(dirname(entry), '..')
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    assert.deepEqual(manifest.dsh?.bundle, { patch: 'cordis.patch.yml' })
    assert.deepEqual(manifest.dsh?.client, { platform: 'web' })
    assert.equal(manifest.exports['./client'], './client.js')
    assert.equal(manifest.dependencies['@trycua/cua-driver'], '0.28.0')
    for (const [resource, expected] of Object.entries({
      './icon': './icon.svg',
      './locale/en.json': './locale/en.json',
      './locale/zh.json': './locale/zh.json',
    })) {
      assert.equal(manifest.exports[resource], expected)
      assert.ok(existsSync(join(packageRoot, expected)), `${expected} is missing from the tarball`)
    }
    const english = JSON.parse(await readFile(join(packageRoot, 'locale/en.json'), 'utf8'))
    assert.equal(typeof english.meta?.title?.en, 'string')
    assert.equal(typeof english.meta?.description?.zh, 'string', 'the Chinese dictionary keeps an English fallback')
    for (const file of ['src/helper-client.js', 'native/ComputerUse.Helper.dll', 'native/ComputerUse.Helper.exe', 'scripts/acceptance.mjs']) {
      assert.equal(existsSync(join(packageRoot, file)), false, `legacy file ${file} leaked into the tarball`)
    }
    const packedFiles = run(['pack', '--dry-run', '--json'], workspace)
    assert.doesNotMatch(packedFiles, /helper-client|ComputerUse\.Helper|acceptance\.mjs/)
    console.log('tarball pins Cua and excludes the legacy helper')

    const patch = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8')
    assert.match(patch, /name: dsh-computer-use-safe-win\n/)
    assert.doesNotMatch(patch, /dsh-computer-use-safe-win\/client/, 'one package name must mount both halves')
    assert.match(patch, /allowedApps: \[\]/)
    assert.match(patch, /enabled: false/)
    const clientHalf = await readFile(join(packageRoot, 'client.js'), 'utf8')
    assert.match(clientHalf, /__ModuleLoader__\.load\(\{/, 'the shipped client half must be a loadable browser module')
    const requestedModules = [...clientHalf.matchAll(/require\('([^']+)'\)/g)].map(match => match[1])
    assert.deepEqual(requestedModules, ['react'], 'the client half may request only seeded browser modules')
    console.log('bundle patch keeps observation off and ships a loadable client half')

    const plugin = await import(pathToFileURL(entry).href)
    const configRoot = await mkdtemp(join(scratch, 'config-'))
    const configPath = join(configRoot, 'cordis.yml')
    const modules = new Map([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['dsh-computer-use-safe-win', {
        ...plugin,
        inject: ['computerUse', 'tools', 'systemPrompt'],
        apply: async ctx => { await plugin.startSafeWinProvider(ctx, {
          allowedApps: new Set(['notepad.exe']),
          startRuntime: async () => ({ listTargets: async () => [], observe: async () => ({}), close: async () => {} }),
        }) },
      }],
    ])
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: 'dsh-computer-use-safe-win'",
      '  config:',
      '    enabled: true',
      '    allowedApps: [notepad.exe]',
    ].join('\n'))
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(configRoot).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(specifier) {
      if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
      return modules.get(specifier)
    } }
    const registrations = []
    ctx.provide('computerUse', { register(name) { registrations.push(name); return async () => { registrations.pop() } } })
    try {
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      for (const fiber of ctx.loader.entries()) await fiber.fiber?.await()
      const names = ctx.tools.schemas().map(schema => schema.name).sort()
      assert.deepEqual(names, ['safe_win_list_windows', 'safe_win_observe'])
      assert.deepEqual(registrations, ['safe-win'])
      console.log('installed package loads through the real Loader with inspection-only tools')
      await ctx.fiber.dispose()
      assert.deepEqual(registrations, [])
      console.log('unload released the provider slot')
    } finally {
      await ctx.fiber.dispose()
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()
