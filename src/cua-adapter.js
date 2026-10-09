import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CuaDriver,
  EmbeddedEnvironmentVariable,
  PrivateWorkerOptions,
  RuntimeAuthorizationOptions,
  SessionPermissionMode,
} from '@trycua/cua-driver'

const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.resolve('@trycua/cua-driver/package.json'))))
const WINDOWS_BINARY = join(PACKAGE_DIR, 'bin', 'cua-driver.exe')
const HOST_BUNDLE_ID = 'ai.deepseek.dsh.computer-use'
const MAX_ELEMENTS = 200
const MAX_TEXT = 4096
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const ACTION_TIMEOUT_MS = 15_000
const STARTUP_TIMEOUT_MS = 15_000
const SHUTDOWN_TIMEOUT_MS = 5_000

function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error('operation aborted')
}

function withTimeout(promise, timeoutMs, label, signal) {
  let timer
  let onAbort
  const guards = [new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    timer.unref?.()
    if (signal) {
      onAbort = () => reject(abortError(signal))
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })]
  return Promise.race([promise, ...guards]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  })
}

function assertDriver(driver) {
  for (const method of ['listApps', 'listWindows', 'getWindowState', 'verifyState', 'shutdown']) {
    if (typeof driver?.[method] !== 'function') throw new Error(`Cua Driver runtime lacks ${method}`)
  }
}

/**
 * Creates the single SDK-managed private-worker runtime; no desktop discovery occurs during startup.
 */
export async function startCuaRuntime({ driverFactory = CuaDriver.createPrivateWorker, binaryPath = WINDOWS_BINARY, signal } = {}) {
  if (process.platform !== 'win32') throw new Error('Cua computer use currently requires Windows')
  const executable = resolve(binaryPath)
  signal?.throwIfAborted()

  const authorization = RuntimeAuthorizationOptions.create({
    allowedModes: [SessionPermissionMode.Standard],
    compatibilityMode: SessionPermissionMode.Standard,
    unrestrictedAcknowledged: false,
    maxSessionTtlSeconds: 900n,
    maxIdleTtlSeconds: 300n,
  })
  const configuredDriver = {
    claudeCodeCompatibility: false,
    authorization,
  }
  const environment = [EmbeddedEnvironmentVariable.create({ key: 'RUST_LOG', value: 'warn' })]
  const options = PrivateWorkerOptions.create({
    binaryPath: executable,
    hostBundleId: HOST_BUNDLE_ID,
    startupTimeoutMs: BigInt(STARTUP_TIMEOUT_MS),
    shutdownTimeoutMs: BigInt(SHUTDOWN_TIMEOUT_MS),
    configuredDriver,
    environment,
    inheritStderr: false,
  })
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
  #closed = false
  #tail = Promise.resolve()
  #generation = Symbol('cua-runtime-generation')

  constructor(driver) { this.#driver = driver }

  get generation() { return this.#generation }

  #enqueue(operation, signal, timeout = ACTION_TIMEOUT_MS) {
    if (this.#closed) return Promise.reject(new Error('Cua Driver runtime is closed'))
    const run = this.#tail.then(async () => {
      signal?.throwIfAborted()
      if (this.#closed) throw new Error('Cua Driver runtime is closed')
      return withTimeout(Promise.resolve().then(operation), timeout, 'Cua Driver operation', signal)
    })
    this.#tail = run.catch(() => {})
    return run
  }

  async #window(pid, windowId) {
    const [apps, windows] = await Promise.all([
      this.#driver.listApps({}),
      this.#driver.listWindows({ pid, onScreenOnly: false }),
    ])
    const app = apps.apps.find(item => item.pid === pid && item.running)
    const window = windows.windows.find(item => item.pid === pid && item.windowId === windowId)
    if (!app || !window) throw new Error('Cua window process identity is no longer available')
    const filename = app.launchPath?.split(/[\\/]/).pop()
    if (!filename || !/[\\/]/.test(app.launchPath) || !/^[\\w.-]{1,128}\\.exe$/i.test(filename)) throw new Error('Cua did not provide a verifiable Windows process executable filename')
    return Object.freeze({
      pid,
      windowId,
      app: filename.toLowerCase(),
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
      const running = apps.filter(app => app.running && app.launchPath && /[\\/]/.test(app.launchPath) && /^[\\w.-]{1,128}\\.exe$/i.test(app.launchPath.split(/[\\/]/).pop()) && names.has(app.launchPath.split(/[\\/]/).pop().toLowerCase()))
      const windows = await this.#driver.listWindows({ onScreenOnly: true })
      const targets = []
      for (const window of windows.windows) {
        if (!running.some(app => app.pid === window.pid) || !Number.isInteger(window.pid) || window.pid <= 0) continue
        const executable = running.find(app => app.pid === window.pid).launchPath.split(/[\\/]/).pop().toLowerCase()
        targets.push(Object.freeze({ pid: window.pid, windowId: window.windowId, app: executable, title: window.title, bounds: { ...window.bounds }, isOnScreen: window.isOnScreen, minimized: window.minimized === true }))
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
      if (state.pid !== target.pid || state.windowId !== target.windowId || state.degraded) throw new Error('Cua returned an incomplete or degraded window snapshot')
      const elements = Array.isArray(state.elements) ? state.elements : []
      if (elements.length > MAX_ELEMENTS) throw new Error('Cua snapshot exceeds the element limit')
      const safeElements = elements.map(element => {
        const index = Number(element.elementIndex)
        if (!Number.isSafeInteger(index) || index < 0) throw new Error('Cua returned an invalid element index')
        return Object.freeze({
          index,
          role: boundedText(element.role, 80),
          label: boundedText(element.label ?? '', 256),
          value: boundedText(element.value ?? '', 256),
          enabled: element.enabled !== false,
          selected: element.selected === true,
          token: typeof element.elementToken === 'string' ? element.elementToken : undefined,
          actions: Array.isArray(element.actions) ? element.actions.filter(a => typeof a === 'string' && ['click', 'press', 'select', 'toggle'].includes(a.toLowerCase())) : [],
          frame: element.frame ? { ...element.frame } : undefined,
        })
      })
      const images = (state.images ?? []).map(image => {
        const data = Buffer.from(image.dataBase64, 'base64')
        if (data.length > MAX_IMAGE_BYTES) throw new Error('Cua screenshot exceeds the image limit')
        return Object.freeze({ mimeType: image.mimeType, data })
      })
      if (includeScreenshot && (!images.length || images.some(image => !/^image\/(png|jpeg|webp)$/.test(image.mimeType)))) throw new Error('Cua did not return a supported target-window screenshot')
      return Object.freeze({
        target: current,
        snapshotId: state.snapshotId,
        treeMarkdown: boundedText(state.treeMarkdown ?? '', MAX_TEXT),
        elements: safeElements,
        truncated: state.truncated === true,
        degraded: state.degraded === true,
        images,
      })
    }, signal)
  }

  performApprovedClick(target, token, signal) {
    if (typeof token !== 'string' || !token || token.length > 1024) return Promise.reject(new Error('invalid Cua element token'))
    return this.#enqueue(async () => {
      const current = await this.#window(target.pid, target.windowId)
      if (current.app !== target.app || current.title !== target.title || !current.isOnScreen || current.minimized) throw new Error('Cua window identity changed before action')
      throw new Error('Cua 0.28.0 does not expose a verified per-action background semantic click contract; refusing to deliver input')
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
    if (this.#closed) return this.#tail
    this.#closed = true
    this.#generation = Symbol('closed-cua-runtime-generation')
    const final = this.#tail.then(() => withTimeout(this.#driver.shutdown(), SHUTDOWN_TIMEOUT_MS, 'Cua Driver shutdown'))
    this.#tail = final.catch(() => {})
    return final
  }
}

function boundedText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}
