import test from 'node:test'
import assert from 'node:assert/strict'
import { registerDriverRoutes } from '../src/driver-routes.js'

const installed = { installed: true, supported: true, version: '0.28.0', installedVersion: '0.28.0', runtimeVerified: false }

/** Minimal Host stand-in: records exact Fetch routes on the authenticated API channel. */
function harness({ status = async () => installed, install = async () => installed } = {}) {
  const routes = new Map()
  const disposers = []
  const ctx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
    effect(fn, label) { const disposer = fn(); disposers.push({ disposer, label }); return disposer },
  }
  registerDriverRoutes(ctx, { status, install })
  return {
    ctx,
    routes,
    labels: disposers.map(entry => entry.label),
    dispose: () => { for (const { disposer } of disposers) disposer() },
  }
}

const browser = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-computer-use-confirm': 'install-pinned-driver' }
const call = (route, { method = 'GET', headers = {}, body = '', origin = 'http://127.0.0.1:3080' } = {}) =>
  route.fetch(new Request(`${origin}${route.path}`, { method, headers: { ...headers }, body: method === 'POST' ? body : undefined }))

test('both routes live under /api and withdraw with the owning effect', () => {
  const h = harness()
  assert.deepEqual([...h.routes.keys()], ['/api/computer-use-safe-win/status', '/api/computer-use-safe-win/install'])
  assert.deepEqual(h.labels, ['computer-use-safe-win: driver status', 'computer-use-safe-win: driver installation'])
  assert.deepEqual(h.routes.get('/api/computer-use-safe-win/status').methods, ['GET'])
  assert.deepEqual(h.routes.get('/api/computer-use-safe-win/install').methods, ['POST'])
  h.dispose()
  assert.equal(h.routes.size, 0)
})

test('status reports the managed driver without claiming runtime verification', async () => {
  const h = harness()
  try {
    const response = await call(h.routes.get('/api/computer-use-safe-win/status'))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const value = await response.json()
    assert.equal(value.installed, true)
    assert.equal(value.installedVersion, '0.28.0')
    assert.equal(value.runtimeVerified, false)
  } finally { h.dispose() }
})

test('a failed status check reports an error instead of an empty success', async () => {
  const h = harness({ status: async () => { throw new Error('home unreadable') } })
  try {
    await assert.rejects(call(h.routes.get('/api/computer-use-safe-win/status')), /home unreadable/)
  } finally { h.dispose() }
})

test('installation requires the local browser and explicit confirmation', async () => {
  let runs = 0
  const h = harness({ install: async () => { runs += 1; return installed } })
  const route = h.routes.get('/api/computer-use-safe-win/install')
  try {
    const crossSite = await call(route, { method: 'POST', headers: { ...browser, 'sec-fetch-site': 'cross-site' } })
    assert.equal(crossSite.status, 403)
    const remote = await call(route, { method: 'POST', headers: browser, origin: 'http://10.0.0.5:3080' })
    assert.equal(remote.status, 403, 'a Host reached over the network never installs an executable')
    const unconfirmed = await call(route, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } })
    assert.equal(unconfirmed.status, 400)
    const plainText = await call(route, { method: 'POST', headers: { ...browser, 'content-type': 'text/plain' } })
    assert.equal(plainText.status, 400)
    assert.equal(runs, 0, 'a refused request must not download anything')
    const ok = await call(route, { method: 'POST', headers: browser, body: '{}' })
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).installed, true)
    assert.equal(runs, 1)
  } finally { h.dispose() }
})

test('a failed installation reports an error instead of claiming success', async () => {
  const h = harness({ install: async () => { throw new Error('download failed') } })
  try {
    const response = await call(h.routes.get('/api/computer-use-safe-win/install'), { method: 'POST', headers: browser, body: '{}' })
    assert.equal(response.status, 502)
    assert.match((await response.json()).error, /download failed/)
  } finally { h.dispose() }
})

test('one installation runs at a time', async () => {
  let running = 0
  let peak = 0
  const h = harness({ install: async () => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, 10))
    running -= 1
    return installed
  } })
  const route = h.routes.get('/api/computer-use-safe-win/install')
  try {
    const [first, second] = await Promise.all([
      call(route, { method: 'POST', headers: browser, body: '{}' }),
      call(route, { method: 'POST', headers: browser, body: '{}' }),
    ])
    assert.equal(peak, 1)
    assert.deepEqual([first.status, second.status].sort(), [200, 409])
  } finally { h.dispose() }
})