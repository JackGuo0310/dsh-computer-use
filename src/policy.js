const FORBIDDEN = /(?:^|[^a-z])(cmd|powershell|pwsh|terminal|windows terminal|conhost|wt|bash|wsl|ssh|putty|keepass|1password|bitwarden|dsh|deepseek|regedit|taskmgr|mmc|consent|credentialui|logonui)(?:\.exe)?(?:$|[^a-z])/i
const DANGEROUS_WINDOW = /password|passcode|otp|verification|security|permission|sign[ -]?in|log[ -]?in|payment|purchase|checkout|transfer|delete|remove|erase|send|submit|post|publish|install|administrator|elevat|密码|验证码|登录|支付|购买|转账|删除|发送|提交|安装|权限|安全/i

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
  if (!window || typeof window !== 'object' || !Number.isSafeInteger(window.pid) || window.pid <= 0) throw new Error('invalid Cua window process identity')
  if (typeof window.windowId !== 'bigint' || window.windowId <= 0n) throw new Error('invalid Cua window identity')
  const app = appName(window.app)
  if (!allowedApps.has(app) || FORBIDDEN.test(app)) throw new Error('window is outside the allowlist')
  if (typeof window.title !== 'string' || !window.title.trim() || window.title.length > 512 || FORBIDDEN.test(window.title) || DANGEROUS_WINDOW.test(window.title)) throw new Error('window title is unsafe')
  if (!window.bounds || ![window.bounds.x, window.bounds.y, window.bounds.width, window.bounds.height].every(Number.isFinite) || window.bounds.width <= 0 || window.bounds.height <= 0) throw new Error('invalid window geometry')
  if (window.isOnScreen !== true || window.minimized === true) throw new Error('window is not currently visible')
  return Object.freeze({ windowId: window.windowId, pid: window.pid, app, title: window.title, bounds: Object.freeze({ ...window.bounds }), isOnScreen: true, minimized: false })
}
