import schema from '@deepseek-ai/schemastery'
import { validateAllowedApps } from './config-policy.js'

// One allowlist entry is either a bare executable filename or an absolute
// executable path; `policy.js` is the single definition of both forms, and this
// pattern is its schema-side mirror so a Settings write is rejected on the spot.
const allowlistEntryPattern = schema.string().pattern(/^(?:[\w.-]{1,128}\.exe|[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]+\.exe)$/i)

export const SettingsSchema = schema.object({
  enabled: schema.boolean().default(false).volatile(),
  allowedApps: schema.array(allowlistEntryPattern).max(64).default([]).volatile(),
})

export function validateSettingsDraft(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config object required')
    if (typeof value.enabled !== 'boolean') throw new Error('enabled must be an explicit boolean')
    if (!Array.isArray(value.allowedApps)) throw new Error('allowedApps must be an array')
    if (value.enabled && value.allowedApps.length === 0) throw new Error('enabled observation requires a nonempty executable allowlist')
    const allowedApps = value.allowedApps.length > 0 ? validateAllowedApps(value.allowedApps) : []
    return { value: { enabled: value.enabled, allowedApps } }
  } catch (error) {
    return { issues: [{ message: error.message }] }
  }
}

export function validateSettingsConfig(value) {
  const result = validateSettingsDraft(value)
  if (result.issues) throw new Error(result.issues[0].message)
  return result.value
}
