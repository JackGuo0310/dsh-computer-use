import { resolve } from 'node:path'
import { getDriverPaths, getDriverStatus } from './driver-install.js'
import { buildPrivateWorkerOptions, STARTUP_TIMEOUT_MS } from './driver-options.js'
import { ACTION_TIMEOUT_MS, OperationQueue, withTimeout } from './operation-queue.js'
import { executableFromLaunchPath } from './policy.js'
import { MAX_ELEMENTS, projectSnapshot } from './snapshot-policy.js'
import {
  CuaDriver,
} from '@trycua/cua-driver'

function assertDriver(driver) {
  for (const method of ['listApps', 'listWindows', 'getWindowState', 'verifyState', 'shutdown']) {
    if (typeof driver?.[method] !== 'function') throw new Error(`Cua Driver runtime lacks ${method}`)
  }
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
    const filename = executableFromLaunchPath(app.launchPath)
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
        const name = executableFromLaunchPath(app.launchPath)
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
