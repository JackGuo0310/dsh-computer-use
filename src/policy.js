const FORBIDDEN = /(?:^|[^a-z])(cmd|powershell|pwsh|terminal|windows terminal|conhost|wt|bash|wsl|ssh|putty|keepass|1password|bitwarden|dsh|deepseek|regedit|taskmgr|mmc|consent|credentialui|logonui)(?:\.exe)?(?:$|[^a-z])/i
const DANGEROUS_WINDOW = /password|passcode|otp|verification|security|permission|sign[ -]?in|log[ -]?in|payment|purchase|checkout|transfer|delete|remove|erase|send|submit|post|publish|install|administrator|elevat|密码|验证码|登录|支付|购买|转账|删除|发送|提交|安装|权限|安全/i

/**
 * Windows executable filename accepted by the allowlist: a bare basename, never a
 * path. This is the one definition of the accepted form; the Cua adapter reuses it
 * so its filtering cannot drift from the allowlist it enforces.
 */
export const EXECUTABLE_NAME = /^[\w.-]{1,128}\.exe$/i

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
 * Extract the executable filename from a Cua `launchPath`.
 *
 * The driver reports absolute paths, and the allowlist matches filenames only. A
 * path without a separator, or with an unusable basename, yields `undefined`
 * rather than a partial match.
 *
 * @param launchPath - Launch path reported by the driver for one running app.
 * @returns The lowercased filename, or `undefined`.
 */
export function executableFromLaunchPath(launchPath) {
  if (typeof launchPath !== 'string' || !/[\\/]/.test(launchPath)) return undefined
  return executableName(launchPath.split(/[\\/]/).pop())
}

/**
 * Resolve the executable filename the allowlist matches for one listed app.
 *
 * The driver does not always report `launchPath`: packaged Windows applications
 * (Notepad on Windows 11, for one) appear with only `name` set to the executable
 * filename. Either source may therefore supply the filename, but when both are
 * present and disagree the app is refused rather than resolved to one of them,
 * because the allowlist decision would otherwise depend on which field won.
 *
 * @param app - `AppInfo` entry from the driver's app listing.
 * @returns The lowercased filename, or `undefined` when it cannot be resolved.
 */
export function executableFromApp(app) {
  const fromPath = executableFromLaunchPath(app?.launchPath)
  const fromName = executableName(app?.name)
  if (fromPath !== undefined && fromName !== undefined) return fromPath === fromName ? fromPath : undefined
  return fromPath ?? fromName
}

function appName(value) {
  const name = executableName(value)
  if (name === undefined) throw new Error('invalid executable name')
  return name
}

export function configuredApps(allowedApps) {
  if (!Array.isArray(allowedApps) || allowedApps.length === 0) throw new Error('allowedApps must be a nonempty executable allowlist')
  const names = new Set(allowedApps.map(appName))
  for (const name of names) if (FORBIDDEN.test(name)) throw new Error(`forbidden application: ${name}`)
  return names
}

export function validateWindow(window, allowedApps) {
  if (!window || typeof window !== 'object' || !Number.isSafeInteger(window.pid) || window.pid <= 0) throw new Error('invalid Cua window process identity')
  if (typeof window.windowId !== 'bigint' || window.windowId <= 0n) throw new Error('invalid Cua window identity')
  const app = appName(window.app)
  if (!allowedApps.has(app) || FORBIDDEN.test(app)) throw new Error('window is outside the allowlist')
  if (typeof window.title !== 'string' || !window.title.trim() || window.title.length > 512 || FORBIDDEN.test(window.title) || DANGEROUS_WINDOW.test(window.title)) throw new Error('window title is unsafe')
  if (!window.bounds || ![window.bounds.x, window.bounds.y, window.bounds.width, window.bounds.height].every(Number.isFinite) || window.bounds.width <= 0 || window.bounds.height <= 0) throw new Error('invalid window geometry')
  if (window.isOnScreen !== true || window.minimized === true) throw new Error('window is not currently visible')
  return Object.freeze({ windowId: window.windowId, pid: window.pid, app, title: window.title, bounds: Object.freeze({ ...window.bounds }), isOnScreen: true, minimized: false })
}
