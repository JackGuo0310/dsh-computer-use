import { resolve } from 'node:path'
import { getDriverPaths, getDriverStatus } from './driver-install.js'
import { buildPrivateWorkerOptions, STARTUP_TIMEOUT_MS } from './driver-options.js'
import { ACTION_TIMEOUT_MS, OperationQueue, withTimeout } from './operation-queue.js'
import { executableFromApp } from './policy.js'
import { MAX_ELEMENTS, projectSnapshot } from './snapshot-policy.js'
import {
  ActionTarget,
  ClickButton,
  ClickPosition,
  CuaDriver,
  InputDeliveryMode,
} from '@trycua/cua-driver'

const ACTION_EFFECT = ['confirmed', 'partial', 'unverifiable', 'suspected-noop', 'refused']
const ACTION_ROUTE = ['accessibility', 'synthetic-events', 'global-input', 'system-api', 'dom', 'trusted-input']
const DELIVERY_MODE = ['background', 'foreground', 'not-applicable', 'unknown']

function assertDriver(driver) {
  for (const method of ['listApps', 'listWindows', 'getWindowState', 'click', 'verifyState', 'shutdown']) {
    if (typeof driver?.[method] !== 'function') throw new Error(`Cua Driver runtime lacks ${method}`)
  }
}

/**
 * Name the driver's own action outcome instead of trusting a bare success.
 *
 * An unrecognized enum value is refused rather than reported as success, so a
 * driver that grows a new effect cannot be read as confirmation.
 *
 * @param result - Raw `ActionResult` from the driver.
 * @returns Frozen named outcome for the tool layer.
 */
export function projectActionResult(result) {
  const effect = ACTION_EFFECT[result?.effect]
  const route = ACTION_ROUTE[result?.route]
  if (effect === undefined || route === undefined) throw new Error('Cua returned an unrecognized action result')
  return Object.freeze({
    effect,
    route,
    delivery: result.delivery === undefined ? undefined : Object.freeze({
      mode: DELIVERY_MODE[result.delivery.mode] ?? 'unknown',
      ...result.delivery.deliveredCount === undefined ? {} : { deliveredCount: result.delivery.deliveredCount },
    }),
    evidenceCount: Array.isArray(result.evidence) ? result.evidence.length : 0,
  })
}

/**
 * Creates the single SDK-managed private-worker runtime; no desktop discovery occurs during startup.
 */
export async function startCuaRuntime({ driverFactory = CuaDriver.createPrivateWorker, binaryPath, signal } = {}) {
  if (process.platform !== 'win32') throw new Error('Cua computer use currently requires Windows')
  if (binaryPath === undefined && !(await getDriverStatus()).installed) throw new Error(`Cua Driver ${getDriverPaths().asset} is not installed as a complete managed release`)
  const executable = resolve(binaryPath ?? getDriverPaths().executable)
  signal?.throwIfAborted()

  const options = buildPrivateWorkerOptions(executable)
  const driver = await withTimeout(
    Promise.resolve().then(() => driverFactory(options)),
    STARTUP_TIMEOUT_MS,
    'Cua Driver private worker startup',
    signal,
  )
  try {
    assertDriver(driver)
    return new CuaRuntime(driver)
  } catch (error) {
    await Promise.resolve(driver?.shutdown?.()).catch(() => {})
    throw error
  }
}

export class CuaRuntime {
  #driver
  #queue = new OperationQueue()

  constructor(driver) { this.#driver = driver }

  get generation() { return this.#queue.generation }

  /** One driver call at a time; an abandoned call quarantines the runtime. */
  #enqueue(operation, signal, timeout = ACTION_TIMEOUT_MS) {
    return this.#queue.run(operation, { signal, timeoutMs: timeout, label: 'Cua Driver operation' })
  }

  async #window(pid, windowId) {
    const [apps, windows] = await Promise.all([
      this.#driver.listApps({}),
      this.#driver.listWindows({ pid, onScreenOnly: false }),
    ])
    const app = apps.apps.find(item => item.pid === pid && item.running)
    const window = windows.windows.find(item => item.pid === pid && item.windowId === windowId)
    if (!app || !window) throw new Error('Cua window process identity is no longer available')
    const filename = executableFromApp(app)
    if (filename === undefined) throw new Error('Cua did not provide a verifiable Windows process executable filename')
    return Object.freeze({
      pid,
      windowId,
      app: filename,
      title: window.title,
      bounds: Object.freeze({ ...window.bounds }),
      isOnScreen: window.isOnScreen,
      minimized: window.minimized === true,
    })
  }

  listTargets(allowedApps, signal) {
    const names = new Set([...allowedApps].map(name => name.toLowerCase()))
    return this.#enqueue(async () => {
      const { apps } = await this.#driver.listApps({})
      const allowed = new Map()
      for (const app of apps) {
        if (!app.running) continue
        const name = executableFromApp(app)
        if (name !== undefined && names.has(name)) allowed.set(app.pid, name)
      }
      const { windows } = await this.#driver.listWindows({ onScreenOnly: true })
      const targets = []
      for (const window of windows) {
        if (!Number.isInteger(window.pid) || window.pid <= 0) continue
        const name = allowed.get(window.pid)
        if (name === undefined) continue
        targets.push(Object.freeze({
          pid: window.pid, windowId: window.windowId, app: name, title: window.title,
          bounds: { ...window.bounds }, isOnScreen: window.isOnScreen, minimized: window.minimized === true,
        }))
      }
      return targets
    }, signal)
  }

  observe(target, { includeScreenshot = false, signal } = {}) {
    return this.#enqueue(async () => {
      const current = await this.#window(target.pid, target.windowId)
      if (current.app !== target.app || current.title !== target.title || current.minimized || !current.isOnScreen) throw new Error('Cua window identity changed or is not visible')
      const state = await this.#driver.getWindowState({
        pid: target.pid,
        windowId: target.windowId,
        includeAccessibilityTree: true,
        includeScreenshot,
        maxElements: MAX_ELEMENTS,
        maxDepth: 12,
        maxDimension: 4096,
      })
      return Object.freeze({ target: current, ...projectSnapshot(state, target, { includeScreenshot }) })
    }, signal)
  }

  /**
   * Deliver one semantic click to an element of a freshly observed target window.
   *
   * Delivery is hard-coded to `InputDeliveryMode.Background` and the position to an
   * element token: this method accepts no foreground mode and no raw coordinates,
   * so a caller cannot silently switch coordinate spaces or raise a window. The
   * window identity is re-read immediately before the click. The driver's own
   * `ActionResult` is projected and returned; the caller decides what an
   * unconfirmed effect means, and must never retry by escalating.
   *
   * @param target - Frozen window identity from a fresh listing.
   * @param elementToken - Token from a snapshot of that same window.
   * @param signal - Optional abort signal.
   * @returns Projected action result with effect, route, and delivery status.
   */
  click(target, elementToken, signal) {
    if (typeof elementToken !== 'string' || !elementToken || elementToken.length > 1024) return Promise.reject(new Error('invalid Cua element token'))
    return this.#enqueue(async () => {
      const current = await this.#window(target.pid, target.windowId)
      if (current.app !== target.app || current.title !== target.title || !current.isOnScreen || current.minimized) throw new Error('Cua window identity changed before action')
      const result = await this.#driver.click({
        target: new ActionTarget.Window({ pid: target.pid, windowId: target.windowId }),
        position: new ClickPosition.Element({ elementToken }),
        deliveryMode: InputDeliveryMode.Background,
        button: ClickButton.Left,
        count: 1,
      })
      return projectActionResult(result)
    }, signal)
  }

  verify(target, predicate, signal) {
    return this.#enqueue(async () => this.#driver.verifyState({
      pid: BigInt(target.pid),
      windowId: target.windowId,
      expect: [{ element: { selector: { role: predicate.selector.role, labelContains: predicate.selector.labelContains }, exists: true } }],
      timeoutMs: 0n,
      stableSamples: 1n,
      includeScreenshot: false,
    }), signal)
  }

  close() {
    return this.#queue.close(() => this.#driver.shutdown())
  }
}
