import test from 'node:test'
import assert from 'node:assert/strict'
import * as Plugin from '../src/plugin.js'
import { registerDriverRoutes } from '../src/driver-routes.js'

function host() {
  const routes = new Map()
  const ctx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
    effect(fn) { return fn() },
    // This profile mounts no `computerUse` registry, which is the default: the
    // provider must mount anyway and only wait for the service dynamically.
    get() { return undefined },
    inject() { return () => {} },
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
  assert.ok(h.routes.has('/api/computer-use-safe-win/running-apps'), 'the allowlist picker route must be offered')
  assert.ok(h.routes.has('/api/computer-use-safe-win/registry-setup'), 'the panel must be able to ask how to mount the optional registry')
  const picker = h.routes.get('/api/computer-use-safe-win/running-apps')
  // Reading the running applications enumerates processes, so a request that is
  // not the local browser must be refused before any driver work.
  const remote = await picker.fetch(new Request('http://dsh.internal/api/computer-use-safe-win/running-apps', {
    method: 'POST',
    headers: { host: 'example.com:443', 'sec-fetch-site': 'same-origin' },
    body: '{}',
  }))
  assert.equal(remote.status, 403)
  assert.match((await remote.json()).error, /local authenticated browser/)
  const crossSite = await picker.fetch(new Request('http://dsh.internal/api/computer-use-safe-win/running-apps', {
    method: 'POST',
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
    body: '{}',
  }))
  assert.equal(crossSite.status, 403)
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

test('the allowlist accepts an absolute path entry as well as a filename', () => {
  // The Host validator returns the normalized, lowercase form it will persist.
  assert.deepEqual(Plugin.validateConfig({ enabled: true, allowedApps: ['C:\\Program Files\\App\\app.exe'] }).allowedApps, ['c:\\program files\\app\\app.exe'])
  assert.deepEqual(Plugin.validateConfig({ enabled: true, allowedApps: ['Notepad.exe'] }).allowedApps, ['notepad.exe'])
  assert.throws(() => Plugin.validateConfig({ enabled: true, allowedApps: ['Program Files\\app.exe'] }), /invalid executable name/)
  assert.throws(() => Plugin.validateConfig({ enabled: true, allowedApps: ['C:\\Windows\\System32\\cmd.exe'] }), /forbidden application/)
  // The declared schema only enforces the shape; it keeps what the user typed.
  assert.deepEqual(JSON.parse(JSON.stringify(Plugin.Config({ enabled: false, allowedApps: ['C:\\Program Files\\App\\app.exe'] }).allowedApps.get())), ['C:\\Program Files\\App\\app.exe'])
  assert.throws(() => Plugin.Config({ enabled: false, allowedApps: ['Program Files\\app.exe'] }), /allowedApps/)
})
