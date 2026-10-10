import schema from '@deepseek-ai/schemastery'
import { configuredApps } from './policy.js'

export const SettingsSchema = schema.object({
  enabled: schema.boolean().default(false).volatile(),
  allowedApps: schema.array(schema.string()).default([]).volatile(),
})

export function validateSettingsDraft(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config object required')
    if (typeof value.enabled !== 'boolean') throw new Error('enabled must be an explicit boolean')
    if (!Array.isArray(value.allowedApps)) throw new Error('allowedApps must be an array')
    if (value.enabled && value.allowedApps.length === 0) throw new Error('enabled observation requires a nonempty executable allowlist')
    if (value.allowedApps.length > 0) configuredApps(value.allowedApps)
    const allowedApps = value.allowedApps
    return { value: { enabled: value.enabled, allowedApps } }
  } catch (error) {
    return { issues: [{ message: error.message }] }
  }
}
