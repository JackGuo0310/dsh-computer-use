import { randomUUID } from 'node:crypto'

const FORBIDDEN = /(?:^|[^a-z])(cmd|powershell|pwsh|terminal|windows terminal|conhost|wt|bash|wsl|ssh|putty|keepass|1password|bitwarden|dsh|deepseek|regedit|taskmgr|mmc|consent|credentialui|logonui)(?:\.exe)?(?:$|[^a-z])/i
const DANGEROUS_ELEMENT = /password|passcode|otp|verification|security|permission|sign[ -]?in|log[ -]?in|payment|purchase|checkout|transfer|delete|remove|erase|send|submit|post|publish|install|administrator|elevat|密码|验证码|登录|支付|购买|转账|删除|发送|提交|安装|权限|安全/i
const SAFE_TYPES = new Set(['Button', 'CheckBox', 'RadioButton', 'MenuItem', 'TabItem', 'ListItem'])
const SAFE_PATTERNS = new Set(['Invoke', 'Select', 'Toggle'])

function appName(value) {
  if (typeof value !== 'string' || !/^[\w.-]{1,128}\.exe$/i.test(value)) throw new Error('invalid executable name')
  return value.toLowerCase()
}

export function configuredApps(allowedApps) {
  if (!Array.isArray(allowedApps) || allowedApps.length === 0) throw new Error('allowedApps must be a nonempty executable allowlist')
  const names = new Set(allowedApps.map(appName))
  for (const name of names) if (FORBIDDEN.test(name)) throw new Error(`forbidden application: ${name}`)
  return names
}

export function validateWindow(window, allowedApps) {
  if (!window || typeof window !== 'object' || !Number.isSafeInteger(window.hwnd) || window.hwnd <= 0 || !Number.isSafeInteger(window.pid) || window.pid <= 0) throw new Error('invalid window identity')
  const app = appName(window.app)
  if (!allowedApps.has(app) || FORBIDDEN.test(app)) throw new Error('window is outside the allowlist')
  if (typeof window.title !== 'string' || !window.title.trim() || window.title.length > 512 || FORBIDDEN.test(window.title) || DANGEROUS_ELEMENT.test(window.title)) throw new Error('window title is unsafe')
  return { hwnd: window.hwnd, pid: window.pid, app, title: window.title }
}

function sameWindow(a, b) {
  return a.hwnd === b.hwnd && a.pid === b.pid && a.app === b.app && a.title === b.title
}

function isSensitive(element) {
  return element.password || !element.name.trim() || DANGEROUS_ELEMENT.test(element.name) || DANGEROUS_ELEMENT.test(element.automationId)
}

export class ObservationGate {
  #allowedApps
  // The provider slot is exclusive but shared by every agent, so observations are
  // held per agent: one agent observing must not invalidate another's pending
  // action, and one agent acting must not block another's observation.
  #observations = new Map()
  #busy = new Set()

  constructor(allowedApps) { this.#allowedApps = configuredApps(allowedApps) }

  record(owner, window, elements, helperId) {
    if (this.#busy.has(owner)) throw new Error('operation in progress')
    this.#observations.delete(owner)
    const identity = validateWindow(window, this.#allowedApps)
    if (typeof helperId !== 'string' || !/^[a-f0-9]{32}$/i.test(helperId)) throw new Error('invalid helper observation')
    if (!Array.isArray(elements) || elements.length > 100) throw new Error('invalid element inventory')
    const safeElements = elements.map(element => {
      if (!element || typeof element !== 'object' || !SAFE_TYPES.has(element.type) || typeof element.name !== 'string' || element.name.length > 256 || typeof element.automationId !== 'string' || element.automationId.length > 256 || typeof element.password !== 'boolean' || !Array.isArray(element.patterns) || element.patterns.length > 3 || element.patterns.some(pattern => !SAFE_PATTERNS.has(pattern))) throw new Error('invalid element')
      return Object.freeze({ type: element.type, name: element.name, automationId: element.automationId, password: element.password, patterns: Object.freeze([...element.patterns]) })
    })
    // Surface application text as data, never as something the model should reason
    // about as a target: a control whose own label is sensitive never reaches the
    // model, and the reported index always addresses the same helper-side control.
    const visible = safeElements
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => !isSensitive(element))
    if (visible.length === 0) throw new Error('no safely actionable control was observed')
    // The model addresses a position in this filtered list, so the reported index
    // is the position here; the helper-side index is kept only for delivery.
    const reported = visible.map(({ element }, position) => Object.freeze({ ...element, index: position }))
    this.#observations.set(owner, { id: randomUUID(), helperId, created: Date.now(), identity, elements: reported, helperIndex: visible.map(entry => entry.index) })
    return { observationId: this.#observations.get(owner).id, window: identity, elements: reported }
  }

  forget(owner) {
    if (this.#busy.has(owner)) throw new Error('operation in progress')
    this.#observations.delete(owner)
  }

  /** Drops every pending observation, used when the provider is torn down. */
  forgetAll() {
    if (this.#busy.size) throw new Error('operation in progress')
    this.#observations.clear()
  }

  async execute({ owner, observationId, index, action, currentWindow, approve, deliver }) {
    if (this.#busy.has(owner)) throw new Error('operation in progress')
    this.#busy.add(owner)
    const observation = this.#observations.get(owner)
    this.#observations.delete(owner) // Consume before any await, including denials or ambiguous failures.
    try {
      if (!observation || observation.id !== observationId || Date.now() - observation.created > 30_000) throw new Error('stale observation')
      if (!Number.isInteger(index) || index < 0 || index >= observation.elements.length || !SAFE_PATTERNS.has(action)) throw new Error('unsupported action')
      const element = observation.elements[index]
      if (!element || !SAFE_TYPES.has(element.type) || !SAFE_PATTERNS.has(action) || !element.patterns.includes(action)) throw new Error('element is not safely actionable')
      if (isSensitive(element)) throw new Error('element is sensitive or has unknown consequences')
      // Every state-changing action requires an explicit one-shot approval; no model-supplied risk field.
      const outcome = await approve({ window: observation.identity, element: { name: element.name, automationId: element.automationId, type: element.type }, action })
      if (outcome !== 'allowed-once') throw new Error(`action was not approved (${outcome})`)
      if (Date.now() - observation.created > 30_000) throw new Error('observation expired while awaiting approval')
      // Re-check the window immediately before delivery. The approval may have
      // taken a while, and the window can be replaced while the user decides, so
      // the identity verified at observation time is not evidence about now.
      const liveWindow = validateWindow(await currentWindow(observation.identity), this.#allowedApps)
      if (!sameWindow(observation.identity, liveWindow)) throw new Error('window changed after approval')
      if (Date.now() - observation.created > 30_000) throw new Error('observation expired before delivery')
      // The model addressed a filtered view; deliver to the control it named.
      return await deliver({ window: liveWindow, helperId: observation.helperId, index: observation.helperIndex[index], action })
    } finally {
      this.#busy.delete(owner)
    }
  }
}
