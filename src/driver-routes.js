import { getDriverStatus, installDriver } from './driver-install.js'

const CONTENT_TYPE = 'content-type'
const STATUS = '/api/computer-use-safe-win/status'
const INSTALL = '/api/computer-use-safe-win/install'
const CONFIRM_HEADER = 'x-computer-use-confirm'
const CONFIRMATION = 'install-pinned-driver'
const installing = new WeakMap()

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

/**
 * Whether the request came from a browser page served by this Host.
 * The API fence already restricts `Host` to loopback or a configured trusted
 * name, so a loopback authority plus a same-site marker means the person
 * sitting at this machine; a browser cannot forge either header.
 */
function localBrowser(request) {
  let hostname
  try {
    hostname = new URL(request.url).hostname
  } catch {
    return false
  }
  return (hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname))
    && request.headers.get('sec-fetch-site') === 'same-origin'
}

/**
 * Register the driver status and installation routes on the authenticated API
 * channel. Neither route starts the Cua worker or enumerates the desktop.
 * @param ctx - Host context owning `connection` and the provider.
 * @param operations - status and installation implementations; defaults read the real managed directory.
 */
export function registerDriverRoutes(ctx, { status = getDriverStatus, install = installDriver } = {}) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: STATUS,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json(await status()),
  }), 'computer-use-safe-win: driver status')

  ctx.effect(() => ctx.connection.fetch.register({
    path: INSTALL,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      if (!localBrowser(request)) return json({ error: 'Driver installation requires the local browser on the Host' }, 403)
      if (request.headers.get(CONTENT_TYPE) !== 'application/json' || request.headers.get(CONFIRM_HEADER) !== CONFIRMATION) {
        return json({ error: 'Explicit installation confirmation required' }, 400)
      }
      if (installing.has(ctx)) return json({ error: 'Driver installation is already in progress' }, 409)
      const operation = Promise.resolve().then(() => install())
      installing.set(ctx, operation)
      try { return json(await operation) } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Driver installation failed' }, 502)
      } finally { installing.delete(ctx) }
    },
  }), 'computer-use-safe-win: driver installation')
}