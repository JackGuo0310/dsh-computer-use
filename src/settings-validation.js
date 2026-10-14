import schema from '@deepseek-ai/schemastery'
import { validateAllowedApps } from './config-policy.js'

// One allowlist entry is either a bare executable filename or an absolute
// executable path; `policy.js` is the single definition of both forms, and this
// pattern is its schema-side mirror so a Settings write is rejected on the spot.
const allowlistEntryPattern = schema.string().pattern(/^(?:[\w.-]{1,128}\.exe|[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]+\.exe)$/i)

/** Upper bound on clicks per session, so a coordinate loop cannot run away. */
export const MAX_CLICK_BUDGET = 50

export const SettingsSchema = schema.object({
  enabled: schema.boolean().default(false).volatile(),
  allowedApps: schema.array(allowlistEntryPattern).max(64).default([]).volatile(),
  // Coordinate clicks are the pixel path for windows with no accessibility
  // tree. They carry no element identity, so they stay OFF by default: the
  // plugin is observation-only until a person turns this on in Settings.
  allowCoordinateClicks: schema.boolean().default(false).volatile(),
  clickBudgetPerSession: schema.number().min(1).max(MAX_CLICK_BUDGET).default(5).volatile(),
})

export function validateSettingsDraft(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config object required')
    if (typeof value.enabled !== 'boolean') throw new Error('enabled must be an explicit boolean')
    if (!Array.isArray(value.allowedApps)) throw new Error('allowedApps must be an array')
    if (value.enabled && value.allowedApps.length === 0) throw new Error('enabled observation requires a nonempty executable allowlist')
    // The click fields are optional on read so a profile written by an earlier
    // version still loads; absent means "off, budget 5". A Settings write always
    // sends both, and the schema supplies the defaults on that path.
    if (value.allowCoordinateClicks !== undefined && typeof value.allowCoordinateClicks !== 'boolean') {
      throw new Error('allowCoordinateClicks must be an explicit boolean')
    }
    const clickBudgetPerSession = value.clickBudgetPerSession ?? 5
    if (!Number.isInteger(clickBudgetPerSession) || clickBudgetPerSession < 1 || clickBudgetPerSession > MAX_CLICK_BUDGET) {
      throw new Error(`clickBudgetPerSession must be a whole number between 1 and ${MAX_CLICK_BUDGET}`)
    }
    const allowedApps = value.allowedApps.length > 0 ? validateAllowedApps(value.allowedApps) : []
    return {
      value: {
        enabled: value.enabled,
        allowedApps,
        allowCoordinateClicks: value.allowCoordinateClicks ?? false,
        clickBudgetPerSession,
      },
    }
  } catch (error) {
    return { issues: [{ message: error.message }] }
  }
}

export function validateSettingsConfig(value) {
  const result = validateSettingsDraft(value)
  if (result.issues) throw new Error(result.issues[0].message)
  return result.value
}
