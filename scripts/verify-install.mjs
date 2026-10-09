import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

const npmCli = process.env.npm_execpath
  ?? join(process.env.APPDATA ?? join(homedir(), '.npm'), 'npm/node_modules/npm/bin/npm-cli.js')
const run = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8' })
const workspace = fileURLToPath(new URL('..', import.meta.url))

/** Install the packed package the way a person installs it, then load it through the real Loader. */
async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-verify-install-'))
  try {
    const tarballInfo = JSON.parse(run(['pack', '--json'], workspace).trim())['dsh-computer-use-safe-win']
    const tarball = join(workspace, tarballInfo.filename)
    const installDir = join(scratch, 'install')
    await mkdir(installDir)
    await writeFile(join(installDir, 'package.json'), JSON.stringify({ private: true }))
    run(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], installDir)
    const require = createRequire(join(installDir, 'noop.js'))
    const entry = require.resolve('dsh-computer-use-safe-win/package.json')
    const packageRoot = dirname(entry)
    const manifest = JSON.parse(await readFile(entry, 'utf8'))

    // The installed package must load as a Loader row with observation off and expose its settings routes.
    const configRoot = join(scratch, 'config')
    const configPath = join(configRoot, 'cordis.yml')
    await mkdir(configRoot)
    const plugin = await import(pathToFileURL(join(packageRoot, 'src', 'plugin.js')).href)
    const routes = new Map()
    const modules = new Map([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['dsh-computer-use-safe-win', plugin],
    ])
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: 'dsh-computer-use-safe-win'",
      '  config:',
      '    enabled: false',
      '    allowedApps: []',
      '',
    ].join('\n'))
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(configRoot).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(specifier) {
      if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
      return modules.get(specifier)
    } }
    await ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } })
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    for (const fiber of ctx.loader.entries()) await fiber.fiber?.await()
    assert.deepEqual([...routes.keys()], ['/api/computer-use-safe-win/status', '/api/computer-use-safe-win/install'])
    assert.deepEqual(ctx.tools.schemas(), [], 'an installed but unconfigured plugin exposes no tool')
    const status = await routes.get('/api/computer-use-safe-win/status').fetch(new Request('http://127.0.0.1:3080/api/computer-use-safe-win/status'))
    const report = await status.json()
    assert.equal(typeof report.supported, 'boolean')
    assert.equal(typeof report.version, 'string')
    assert.equal(report.installedVersion === null || typeof report.installedVersion === 'string', true)
    await ctx.fiber.dispose()
    assert.equal(routes.size, 0, 'unload withdraws the settings routes')

    // The browser half is a loadable module whose only module request is the seeded React.
    const clientHalf = await readFile(join(packageRoot, manifest.exports['./client']), 'utf8')
    assert.match(clientHalf, /^window\.__ModuleLoader__\.load\(\{/)
    assert.deepEqual([...clientHalf.matchAll(/require\('([^']+)'\)/g)].map(match => match[1]), ['react'])
    console.log('tagged package installs, loads through the Loader, and reports driver status')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()