import { resolve } from 'node:path'
import { getDriverPaths, getDriverStatus } from './driver-install.js'
import { buildPrivateWorkerOptions, STARTUP_TIMEOUT_MS } from './driver-options.js'
import { ACTION_TIMEOUT_MS, OperationQueue, withTimeout } from './operation-queue.js'
import { identityFromApp } from './policy.js'
import { boundedText, MAX_ELEMENTS, projectSnapshot } from './snapshot-policy.js'
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
/** Per-call ceiling on literal text, keeping one typed value inside the model budget. */
const MAX_TYPED_TEXT = 4096

/**
 * Name the outcome of a text or key entry.
 *
 * `typeText` and `pressKey` return a `ToolResult` rather than an `ActionResult`:
 * there is no effect, route, or delivery status, so a success only means the
 * driver accepted the request. The window is the only evidence it landed.
 *
 * @param result - Raw `ToolResult` from the driver.
 * @param label - Operation name used in the refusal message.
 * @returns Frozen outcome for the tool layer.
 */
export function projectTextResult(result, label) {
  if (result?.isError === true) throw new Error(`${label} was refused: ${boundedText(result.text, 200) || 'no reason given'}`)
  if (typeof result?.text !== 'string') throw new Error(`Cua returned an unreadable result for ${label}`)
  return Object.freeze({ accepted: true, message: boundedText(result.text, 200) })
}

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
    const identity = identityFromApp(app)
    if (identity === undefined) throw new Error('Cua did not provide a verifiable Windows process executable identity')
    return Object.freeze({
      pid,
      windowId,
      app: identity.name,
      ...identity.path === undefined ? {} : { path: identity.path },
      title: window.title,
      bounds: Object.freeze({ ...window.bounds }),
      isOnScreen: window.isOnScreen,
      minimized: window.minimized === true,
    })
  }

  /**
   * List on-screen windows whose executable identity the allowlist admits.
   *
   * @param allowlist - Parsed {@link Allowlist} of filename and path entries.
   * @param signal - Optional abort signal.
   * @returns Frozen window identities carrying the matched app name and path.
   */
  listTargets(allowlist, signal) {
    return this.#enqueue(async () => {
      const { apps } = await this.#driver.listApps({})
      const allowed = new Map()
      for (const app of apps) {
        if (!app.running) continue
        const identity = identityFromApp(app)
        if (identity !== undefined && allowlist.matches(identity)) allowed.set(app.pid, identity)
      }
      const { windows } = await this.#driver.listWindows({ onScreenOnly: true })
      const targets = []
      for (const window of windows) {
        if (!Number.isInteger(window.pid) || window.pid <= 0) continue
        const identity = allowed.get(window.pid)
        if (identity === undefined) continue
        targets.push(Object.freeze({
          pid: window.pid,
          windowId: window.windowId,
          app: identity.name,
          ...identity.path === undefined ? {} : { path: identity.path },
          title: window.title,
          bounds: { ...window.bounds },
          isOnScreen: window.isOnScreen,
          minimized: window.minimized === true,
        }))
      }
      return targets
    }, signal)
  }

  /**
   * List the running Windows applications the allowlist can name.
   *
   * Used by the settings picker so a user adds a real executable identity instead
   * of typing one. Apps the driver describes ambiguously, or not at all, are
   * omitted rather than guessed, and window titles are never read.
   *
   * @param signal - Optional abort signal.
   * @returns One `{ name, path?, pid }` record per distinct executable.
   */
  listApplications(signal) {
    return this.#enqueue(async () => {
      const { apps } = await this.#driver.listApps({})
      const seen = new Set()
      const applications = []
      for (const app of apps) {
        if (!app.running) continue
        const identity = identityFromApp(app)
        if (identity === undefined) continue
        const key = identity.path ?? identity.name
        if (seen.has(key)) continue
        seen.add(key)
        applications.push(Object.freeze({ name: identity.name, ...identity.path === undefined ? {} : { path: identity.path }, pid: app.pid }))
      }
      return applications.sort((left, right) => (left.path ?? left.name).localeCompare(right.path ?? right.name))
    }, signal)
  }

  observe(target, { includeScreenshot = false, signal } = {}) {
    return this.#enqueue(async () => {
      const current = await this.#window(target.pid, target.windowId)
      // Identity is the process, the native window handle, and the executable.
      // The title is deliberately not part of it: a window retitles itself as its
      // content changes, and typing into a document is exactly that. An unsafe
      // title is still refused, by `validateWindow` on every observation.
      if (current.app !== target.app || current.minimized || !current.isOnScreen) throw new Error('Cua window identity changed or is not visible')
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
   * window identity is re-read immediately before the click.
   *
   * Verified live against 0.28.0 on Windows 11, on a Notepad window that was
   * visible but not the foreground window (Chrome kept the focus throughout): a
   * background element click reported `route: accessibility`, `delivery.mode:
   * background`, and `effect: unverifiable`, while the window changed state
   * without ever taking focus. Background semantic clicking is therefore a hard
   * capability, and the driver's own report is not evidence that an action took
   * effect. Confirm the outcome from a fresh snapshot of the same window; never
   * retry by escalating, and never treat an unconfirmed result as permission to
   * send the click again.
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
      if (current.app !== target.app || !current.isOnScreen || current.minimized) throw new Error('Cua window identity changed before action')
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

  /**
   * Type literal text into a target window.
   *
   * Unlike `click`, `typeText` declares no delivery mode and returns a plain
   * `ToolResult`, so there is no `effect`, `route`, or `delivery` status to
   * report: a successful return means only that the driver accepted the request.
   * The typed text can only be confirmed by reading the window back.
   *
   * @param target - Frozen window identity from a fresh listing.
   * @param text - Literal text to type.
   * @param signal - Optional abort signal.
   * @returns Projected text-entry outcome.
   */
  typeText(target, text, signal) {
    if (typeof text !== 'string' || text.length === 0) return Promise.reject(new Error('text to type must be a nonempty string'))
    if (text.length > MAX_TYPED_TEXT) return Promise.reject(new Error('text to type exceeds the per-call limit'))
    return this.#enqueue(async () => {
      const current = await this.#window(target.pid, target.windowId)
      if (current.app !== target.app || !current.isOnScreen || current.minimized) throw new Error('Cua window identity changed before typing')
      const result = await this.#driver.typeText({
        text,
        target: new ActionTarget.Window({ pid: target.pid, windowId: target.windowId }),
      })
      return projectTextResult(result, 'typing text')
    }, signal)
  }

  /**
   * Press one key, optionally with modifiers, into a target window.
   *
   * Like {@link typeText} this has no delivery status; the resulting window state
   * is the only evidence that the key did anything.
   *
   * @param target - Frozen window identity from a fresh listing.
   * @param key - Key name such as `Enter` or `Tab`.
   * @param modifiers - Optional modifier keys held during the press.
   * @param signal - Optional abort signal.
   * @returns Projected key-press outcome.
   */
  pressKey(target, key, modifiers = [], signal) {
    if (typeof key !== 'string' || !key || key.length > 64) return Promise.reject(new Error('invalid key name'))
    if (!Array.isArray(modifiers) || modifiers.some(modifier => typeof modifier !== 'string' || modifier.length > 64)) return Promise.reject(new Error('invalid modifiers'))
    return this.#enqueue(async () => {
      const current = await this.#window(target.pid, target.windowId)
      if (current.app !== target.app || !current.isOnScreen || current.minimized) throw new Error('Cua window identity changed before typing')
      const result = await this.#driver.pressKey({
        key,
        target: new ActionTarget.Window({ pid: target.pid, windowId: target.windowId }),
        ...modifiers.length > 0 ? { modifiers } : {},
      })
      return projectTextResult(result, 'pressing a key')
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
