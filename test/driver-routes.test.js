import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerDriverRoutes } from '../src/driver-routes.js'

/** Minimal Host stand-in: records routes and rejects untrusted requests like the real composition. */
function harness({ status = async () => ({ installed: true, supported: true, version: '0.28.0', installedVersion: '0.28.0' }), install = async () => ({ installed: true, supported: true, version: '0.28.0', installedVersion: '0.28.0' }), rejection } = {}) {
  const routes = new Map()
  const disposers = []
  const ctx = {
    connection: { requestRejection: rejection ?? (() => undefined) },
    webServer: { register(route) { routes.set(`${route.kind} ${route.path}`, route); return () => routes.delete(`${route.kind} ${route.path}`) } },
    effect(fn, label) { const disposer = fn(); disposers.push(disposer); return disposer },
  }
  registerDriverRoutes(ctx, { status, install })
  return { ctx, routes, dispose: () => { for (const disposer of disposers) disposer() } }
}

const request = (headers = {}, method = 'GET', address = '127.0.0.1') => Object.assign(new EventEmitter(), { method, url: '/x', headers, socket: { remoteAddress: address } })

const browser = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-computer-use-confirm': 'install-pinned-driver' }

async function invoke(routes, key, req) {
  const headers = {}
  const res = {
    statusCode: 0, body: undefined,
    setHeader(name, value) { headers[name] = value },
    writeHead(status, extra) { this.statusCode = status; Object.assign(headers, extra) },
    end(chunk) { this.body = chunk },
  }
  await routes.get(key).handler(req, res)
  return { status: res.statusCode, body: res.body, headers, json: () => JSON.parse(res.body) }
}

test('status reports the managed driver without touching the desktop', async () => {
  const h = harness()
  try {
    const result = await invoke(h.routes, 'exact /computer-use-safe-win/status', request(browser))
    assert.equal(result.status, 200)
    assert.equal(result.json().installed, true)
    assert.equal(result.json().installedVersion, '0.28.0')
    assert.equal(result.headers['cache-control'], 'no-store')
  } finally { h.dispose() }
})

test('the status route refuses a request the connection service rejects', async () => {
  const h = harness({ rejection: () => 403 })
  try {
    assert.equal((await invoke(h.routes, 'exact /computer-use-safe-win/status', request(browser))).status, 403)
  } finally { h.dispose() }
})

test('installation requires the local authenticated browser and explicit confirmation', async () => {
  let installed = 0
  const h = harness({ install: async () => { installed += 1; return { installed: true } } })
  const key = 'exact /computer-use-safe-win/install'
  try {
    assert.equal((await invoke(h.routes, key, request(browser, 'POST', '10.0.0.5'))).status, 403, 'remote Host must not install')
    assert.equal((await invoke(h.routes, key, request({ ...browser, origin: 'http://evil.test' }, 'POST'))).status, 403)
    assert.equal((await invoke(h.routes, key, request({ ...browser, 'sec-fetch-site': 'cross-site' }, 'POST'))).status, 403)
    assert.equal((await invoke(h.routes, key, request({ ...browser, 'x-computer-use-confirm': undefined }, 'POST'))).status, 400)
    assert.equal((await invoke(h.routes, key, request({ ...browser, 'content-type': 'text/plain' }, 'POST'))).status, 400)
    assert.equal(installed, 0)
    assert.equal((await invoke(h.routes, key, request(browser, 'GET'))).status, 405)
    assert.equal(installed, 0)
    const ok = await invoke(h.routes, key, request(browser, 'POST'))
    assert.equal(ok.status, 200)
    assert.equal(installed, 1)
  } finally { h.dispose() }
})

test('a failed installation reports an error instead of claiming success', async () => {
  const h = harness({ install: async () => { throw new Error('download failed') } })
  try {
    const result = await invoke(h.routes, 'exact /computer-use-safe-win/install', request(browser, 'POST'))
    assert.equal(result.status, 502)
    assert.match(result.json().error, /download failed/)
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
    return { installed: true }
  } })
  const key = 'exact /computer-use-safe-win/install'
  try {
    const [first, second] = await Promise.all([
      invoke(h.routes, key, request(browser, 'POST')),
      invoke(h.routes, key, request(browser, 'POST')),
    ])
    assert.equal(peak, 1)
    assert.deepEqual([first.status, second.status].sort(), [200, 409])
  } finally { h.dispose() }
})

test('disposal withdraws both routes', () => {
  const h = harness()
  assert.equal(h.routes.size, 2)
  h.dispose()
  assert.equal(h.routes.size, 0)
})