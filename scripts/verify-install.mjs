import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
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

/** The Host package that owns plugin display metadata; resolved from the installed DSH. */
async function appBoot() {
  const dsh = join(homedir(), 'AppData/Roaming/npm/node_modules/@deepseek-ai/dsh')
  const manifest = createRequire(join(workspace, 'noop.js')).resolve('@deepseek-ai/dsh-app-boot/package.json', { paths: [dsh] })
  return pathToFileURL(join(dirname(manifest), 'lib', 'index.js')).href
}
const APP_BOOT = await appBoot()

/** Install the packed package the way a person installs it, then load it through the real Loader. */
async function main() {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-verify-install-'))
  try {
    const tarballInfo = JSON.parse(run(['pack', '--json'], workspace).trim())['dsh-computer-use-safe-win']
    const tarball = join(workspace, tarballInfo.filename)
    await writeFile(join(scratch, 'package.json'), JSON.stringify({ private: true }))
    run(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], scratch)
    // npm installs into <scratch>/node_modules, so that directory is the
    // resolution base a plugin row would be read from.
    const installDir = scratch
    const require = createRequire(join(scratch, 'noop.js'))
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

    // The Plugins page reads display metadata through the Host's own reader; a
    // rejected locale file surfaces there as a row-level error. It is run in a
    // child process so resolution starts from the install directory: this
    // script's own imports would otherwise make the workspace source win.
    const probe = `
      import { readPluginMeta } from ${JSON.stringify(APP_BOOT)}
      import { pathToFileURL } from 'node:url'
      process.stdout.write(JSON.stringify(readPluginMeta('dsh-computer-use-safe-win', pathToFileURL(process.argv[1]).href)) ?? 'null')
    `
    const probeFile = join(scratch, 'probe.mjs')
    await writeFile(probeFile, probe)
    const meta = JSON.parse(execFileSync(process.execPath, [probeFile, `${installDir}/`], { encoding: 'utf8' }))
    assert.equal(meta?.error, undefined, `plugin metadata error: ${String(meta?.error)}`)
    assert.equal(typeof meta?.icon, 'string', 'the icon must load')
    assert.equal(meta?.title?.zh, 'Windows 电脑操控（只读）')
    assert.equal(meta?.title?.en, 'Windows Computer Use (read-only)')
    assert.equal(typeof meta?.description?.en, 'string')
    console.log('tagged package installs, loads through the Loader, and reports driver status')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()