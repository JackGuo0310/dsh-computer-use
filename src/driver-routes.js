import { getDriverStatus, installDriver } from './driver-install.js'

const STATUS = '/computer-use-safe-win/status'
const INSTALL = '/computer-use-safe-win/install'
const installingByContext = new WeakMap()

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

/** Register authenticated Host routes; neither route accesses the desktop or starts the worker. */
export function registerDriverRoutes(ctx, { status = getDriverStatus, install = installDriver } = {}) {
  const route = (path, method, handler) => ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path,
    handler: async (req, res) => {
      const denied = ctx.connection.requestRejection(req)
      if (denied !== undefined) { res.writeHead(denied); res.end(); return }
      if (req.method !== method) { res.writeHead(405, { allow: method }); res.end(); return }
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      try {
        const response = await handler(req)
        res.statusCode = response.status
        res.end(await response.text())
      } catch (error) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Driver operation failed' }))
      }
    },
  }), `computer-use-safe-win: ${method} ${path}`)
  route(STATUS, 'GET', async () => json(await status()))
  route(INSTALL, 'POST', async req => {
    // A button click is necessary, not sufficient: require an authenticated, same-origin
    // browser POST. A remote Host is deliberately unable to install the executable.
    const origin = req.headers.origin
    const host = req.headers.host
    const address = req.socket.remoteAddress
    const local = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
    let sameOrigin = false
    try { sameOrigin = typeof origin === 'string' && typeof host === 'string' && new URL(origin).host === host } catch { /* Reject malformed browser Origin. */ }
    if (!local || !sameOrigin || req.headers['sec-fetch-site'] !== 'same-origin') {
      return json({ error: 'Driver installation requires the local authenticated browser' }, 403)
    }
    if (req.headers['content-type'] !== 'application/json' || req.headers['x-computer-use-confirm'] !== 'install-pinned-driver') {
      return json({ error: 'Explicit installation confirmation required' }, 400)
    }
    if (installingByContext.has(ctx)) return json({ error: 'Driver installation is already in progress' }, 409)
    const operation = Promise.resolve().then(() => install())
    installingByContext.set(ctx, operation)
    try { return json(await operation) } finally { installingByContext.delete(ctx) }
  })
}
