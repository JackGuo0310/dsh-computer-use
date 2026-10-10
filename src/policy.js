const FORBIDDEN = /(?:^|[^a-z])(cmd|powershell|pwsh|terminal|windows terminal|conhost|wt|bash|wsl|ssh|putty|keepass|1password|bitwarden|dsh|deepseek|regedit|taskmgr|mmc|consent|credentialui|logonui)(?:\.exe)?(?:$|[^a-z])/i
const DANGEROUS_WINDOW = /password|passcode|otp|verification|security|permission|sign[ -]?in|log[ -]?in|payment|purchase|checkout|transfer|delete|remove|erase|send|submit|post|publish|install|administrator|elevat|密码|验证码|登录|支付|购买|转账|删除|发送|提交|安装|权限|安全/i

/**
 * Windows executable filename accepted by the allowlist: a bare basename, never a
 * path. This is the one definition of the accepted form; the Cua adapter reuses it
 * so its filtering cannot drift from the allowlist it enforces.
 */
export const EXECUTABLE_NAME = /^[\w.-]{1,128}\.exe$/i

/**
 * Absolute Windows executable path accepted by the allowlist, such as
 * `C:\Program Files\App\app.exe`. `..` segments are refused so an entry cannot
 * reach a directory it does not name.
 */
const EXECUTABLE_PATH = /^[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]+\.exe$/i

/**
 * Normalize one executable filename.
 *
 * @param value - Candidate filename.
 * @returns The lowercased filename, or `undefined` when it is not one.
 */
export function executableName(value) {
  return typeof value === 'string' && EXECUTABLE_NAME.test(value) ? value.toLowerCase() : undefined
}

/**
 * Normalize one absolute executable path for comparison.
 *
 * @param value - Candidate absolute path.
 * @returns The normalized lowercase path, or `undefined` when it is not one.
 */
export function executablePath(value) {
  if (typeof value !== 'string' || !EXECUTABLE_PATH.test(value)) return undefined
  if (value.split(/[\\/]/).some(segment => segment === '..')) return undefined
  return value.replace(/\//g, '\\').toLowerCase()
}

/**
 * Classify one allowlist entry.
 *
 * @param value - Candidate entry.
 * @returns `{ kind: 'name' }`, `{ kind: 'path', value }`, or `undefined`.
 */
export function allowlistEntry(value) {
  if (typeof value !== 'string') return undefined
  const path = executablePath(value)
  if (path !== undefined) return { kind: 'path', value: path }
  const name = executableName(value)
  return name === undefined ? undefined : { kind: 'name', value: name }
}

/**
 * Extract the executable filename from a Cua `launchPath`.
 *
 * @param launchPath - Launch path reported by the driver for one running app.
 * @returns The lowercased filename, or `undefined`.
 */
export function executableFromLaunchPath(launchPath) {
  if (typeof launchPath !== 'string' || !/[\\/]/.test(launchPath)) return undefined
  return executableName(launchPath.split(/[\\/]/).pop())
}

/**
 * Resolve the executable identity the allowlist matches for one listed app.
 *
 * The driver does not always report `launchPath`: packaged Windows applications
 * (Notepad on Windows 11, for one) appear with only `name` set to the executable
 * filename. Either source may therefore supply the filename, but when both are
 * present and disagree the app is refused rather than resolved to one of them,
 * because the allowlist decision would otherwise depend on which field won. The
 * path is reported separately so a path entry cannot match an app whose path the
 * driver never supplied.
 *
 * @param app - `AppInfo` entry from the driver's app listing.
 * @returns `{ name?, path? }`, or `undefined` when no usable identity exists.
 */
export function identityFromApp(app) {
  const fromPath = executableFromLaunchPath(app?.launchPath)
  const fromName = executableName(app?.name)
  if (fromPath !== undefined && fromName !== undefined && fromPath !== fromName) return undefined
  const name = fromPath ?? fromName
  if (name === undefined) return undefined
  const path = executablePath(app?.launchPath)
  return path === undefined ? { name } : { name, path }
}

function appName(value) {
  const name = executableName(value)
  if (name === undefined) throw new Error('invalid executable name')
  return name
}

/**
 * The parsed allowlist: a set of filename and absolute-path entries.
 *
 * A path entry only matches an app the driver reported a path for, and a filename
 * entry only matches an app's executable filename. Neither form matches the other,
 * so a path entry is always the stricter of the two and never falls back to a
 * basename it did not name.
 */
export class Allowlist {
  constructor(entries) { this.entries = entries }

  /** Whether this allowlist admits the given app identity. */
  matches({ name, path } = {}) {
    return this.entries.some(entry => entry.kind === 'path'
      ? path !== undefined && path === entry.value
      : name !== undefined && name === entry.value)
  }

  /** Whether this allowlist admits the given executable filename. */
  has(name) { return this.matches({ name: executableName(name) }) }

  /** Iterate the normalized entry values, for logging and tests. */
  *[Symbol.iterator]() { for (const entry of this.entries) yield entry.value }
}

/**
 * Parse and validate the configured allowlist.
 *
 * Entries are non-empty executable filenames or absolute executable paths; a
 * relative path and a path with `..` are refused. Protected executables are
 * refused whether they were named by filename or by path.
 *
 * @param allowedApps - Configured allowlist entries.
 * @returns The parsed {@link Allowlist}.
 */
export function configuredApps(allowedApps) {
  if (!Array.isArray(allowedApps) || allowedApps.length === 0) throw new Error('allowedApps must be a nonempty executable allowlist')
  const entries = allowedApps.map(value => {
    const entry = allowlistEntry(value)
    if (entry === undefined) throw new Error('invalid executable name')
    return entry
  })
  // An allowlist is a set: two entries that resolve to the same value would make
  // the effective allowlist depend on which one the editor listed first.
  const distinct = new Set(entries.map(entry => `${entry.kind}:${entry.value}`))
  if (distinct.size !== entries.length) throw new Error('allowlist contains duplicate application names')
  for (const entry of entries) {
    const basename = entry.kind === 'name' ? entry.value : entry.value.split(/[\\/]/).pop()
    if (FORBIDDEN.test(basename)) throw new Error(`forbidden application: ${entry.value}`)
  }
  return new Allowlist(entries)
}

export function validateWindow(window, allowedApps) {
  if (!window || typeof window !== 'object' || !Number.isSafeInteger(window.pid) || window.pid <= 0) throw new Error('invalid Cua window process identity')
  if (typeof window.windowId !== 'bigint' || window.windowId <= 0n) throw new Error('invalid Cua window identity')
  const app = appName(window.app)
  if (!allowedApps.matches({ name: app, path: window.path === undefined ? undefined : executablePath(window.path) }) || FORBIDDEN.test(app)) throw new Error('window is outside the allowlist')
  if (typeof window.title !== 'string' || !window.title.trim() || window.title.length > 512 || FORBIDDEN.test(window.title) || DANGEROUS_WINDOW.test(window.title)) throw new Error('window title is unsafe')
  if (!window.bounds || ![window.bounds.x, window.bounds.y, window.bounds.width, window.bounds.height].every(Number.isFinite) || window.bounds.width <= 0 || window.bounds.height <= 0) throw new Error('invalid window geometry')
  if (window.isOnScreen !== true || window.minimized === true) throw new Error('window is not currently visible')
  return Object.freeze({
    windowId: window.windowId,
    pid: window.pid,
    app,
    ...window.path === undefined ? {} : { path: executablePath(window.path) },
    title: window.title,
    bounds: Object.freeze({ ...window.bounds }),
    isOnScreen: true,
    minimized: false,
  })
}
