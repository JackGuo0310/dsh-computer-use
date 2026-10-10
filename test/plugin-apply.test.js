import test from 'node:test'
import assert from 'node:assert/strict'
import * as Plugin from '../src/plugin.js'
import { registerDriverRoutes } from '../src/driver-routes.js'

function host() {
  const routes = new Map()
  const ctx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
    effect(fn) { return fn() },
  }
  return { ctx, routes }
}

test('the driver settings routes report status without accessing the desktop', async () => {
  const h = host()
  h.ctx.connection.fetch.register = (route) => { h.routes.set(route.path, route); return () => h.routes.delete(route.path) }
  await Plugin.apply(h.ctx, { enabled: false, allowedApps: [] })
  assert.ok(h.routes.has('/api/computer-use-safe-win/status'))
  assert.ok(h.routes.has('/api/computer-use-safe-win/install'))
  assert.ok(h.routes.has('/api/computer-use-safe-win/validate-config'))
  const response = await h.routes.get('/api/computer-use-safe-win/status').fetch(new Request('http://127.0.0.1/status'))
  const status = await response.json()
  assert.equal(typeof status.installed, 'boolean')
  assert.equal(status.version, '0.28.0')
  assert.equal(status.runtimeVerified, false)
  const validation = await h.routes.get('/api/computer-use-safe-win/validate-config').fetch(new Request('http://127.0.0.1/validate-config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, allowedApps: ['powershell.exe'] }) }))
  assert.equal(validation.status, 400)
  assert.equal((await validation.json()).valid, false)
})

test('the config validator rejects invalid types and empty enabled allowlists', () => {
  assert.equal(typeof Plugin.Config.toJSON, 'function')
  assert.throws(() => Plugin.validateConfig({ enabled: 'true', allowedApps: [] }), /enabled must be an explicit boolean/)
  assert.throws(() => Plugin.validateConfig({ enabled: true, allowedApps: [] }), /nonempty executable allowlist/)
  assert.deepEqual(Plugin.validateConfig({ enabled: false, allowedApps: [] }), { enabled: false, allowedApps: [] })
})
