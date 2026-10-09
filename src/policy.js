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

export class ObservationGate {
  #allowedApps
  #observation = null
  #busy = false

  constructor(allowedApps) { this.#allowedApps = configuredApps(allowedApps) }

  record(window, elements) {
    if (this.#busy) throw new Error('operation in progress')
    const identity = validateWindow(window, this.#allowedApps)
    if (!Array.isArray(elements) || elements.length > 100) throw new Error('invalid element inventory')
    this.#observation = { id: randomUUID(), created: Date.now(), identity, elements }
    return { id: this.#observation.id, window: identity, elements }
  }

  forget() { this.#observation = null }

  async execute({ observationId, index, action, currentWindow, approve, deliver }) {
    if (this.#busy) throw new Error('operation in progress')
    this.#busy = true
    const observation = this.#observation
    this.#observation = null // Consume before any await, including denials or ambiguous failures.
    try {
      if (!observation || observation.id !== observationId || Date.now() - observation.created > 30_000) throw new Error('stale observation')
      if (!Number.isInteger(index) || index < 0 || index >= observation.elements.length || !SAFE_PATTERNS.has(action)) throw new Error('unsupported action')
      const element = observation.elements[index]
      if (!element || !SAFE_TYPES.has(element.type) || typeof element.name !== 'string' || !element.name.trim() || element.name.length > 256 || !Array.isArray(element.patterns) || !element.patterns.includes(action)) throw new Error('element is not safely actionable')
      if (element.password || DANGEROUS_ELEMENT.test(element.name) || DANGEROUS_ELEMENT.test(element.automationId ?? '')) throw new Error('element is sensitive or has unknown consequences')
      // Every state-changing action requires an explicit one-shot approval; no model-supplied risk field.
      const outcome = await approve({ window: observation.identity, element: { name: element.name, type: element.type }, action })
      if (outcome !== 'allowed-once') throw new Error(`action was not approved (${outcome})`)
      const liveWindow = validateWindow(await currentWindow(), this.#allowedApps)
      if (!sameWindow(observation.identity, liveWindow)) throw new Error('window changed after approval')
      return await deliver({ window: liveWindow, element, action })
    } finally {
      this.#busy = false
    }
  }
}
