import test from 'node:test'
import assert from 'node:assert/strict'
import * as Plugin from '../src/plugin.js'

/** Host stand-in exposing only what the default-disabled plugin half reads. */
function host({ installed = false } = {}) {
  const routes = new Map()
  const status = { installed, supported: true, version: '0.28.0', installedVersion: installed ? '0.28.0' : null }
  const ctx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
    effect(fn, label) { const disposer = fn(); return disposer },
    logger: { warn() {}, error() {} },
  }
  return { ctx, routes, status }
}

test('the installed plugin always offers its settings row without touching the desktop', async () => {
  const h = host()
  const tools = []
  const desktop = { started: false }
  h.ctx.tools = { register: tool => () => { tools.push(tool) } }
  h.ctx.computerUse = { register: () => async () => {} }
  h.ctx.systemPrompt = { section: () => () => {}, getSectionOrder: () => 0 }

  await Plugin.apply(h.ctx, { enabled: false, allowedApps: [] })

  assert.deepEqual([...h.routes.keys()], ['/api/computer-use-safe-win/status', '/api/computer-use-safe-win/install'])
  assert.deepEqual(tools, [], 'an unconfigured plugin exposes no observation tool')
  assert.equal(desktop.started, false)

  const status = await h.routes.get('/api/computer-use-safe-win/status').fetch(new Request('http://127.0.0.1:3080/api/computer-use-safe-win/status'))
  assert.equal((await status.json()).installed, false, 'the settings page can test an absent driver')
})

test('enabling observation without an installed driver fails closed', async () => {
  const h = host({ installed: false })
  await assert.rejects(
    Plugin.apply(h.ctx, { enabled: true, allowedApps: ['notepad.exe'] }),
    /install the pinned Cua Driver/,
  )
})

test('the config validator refuses a non-boolean enabled flag and an empty enabled allowlist', () => {
  const validate = Plugin.Config['~standard'].validate
  assert.ok(validate({ enabled: 'true', allowedApps: [] }).issues)
  assert.ok(validate({ enabled: true, allowedApps: [] }).issues, 'enabling observation requires an allowlist')
  assert.ok(validate({ enabled: false, allowedApps: [] }).value, 'the default patch loads')
  assert.deepEqual(validate({ enabled: false, allowedApps: [] }).value, { enabled: false, allowedApps: [] })
})