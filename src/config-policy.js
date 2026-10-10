import { configuredApps } from './policy.js'

export function normalizeAllowedApps(input) {
  if (typeof input !== 'string') throw new Error('allowlist must be text')
  return validateAllowedApps(input.split(/[\r\n,;]+/).map(value => value.trim()).filter(Boolean))
}

export function validateAllowedApps(entries) {
  if (!Array.isArray(entries) || entries.some(value => typeof value !== 'string')) throw new Error('allowlist must contain executable names')
  if (entries.length > 64) throw new Error('allowlist cannot contain more than 64 applications')
  const normalized = entries.map(value => value.toLowerCase())
  if (new Set(normalized).size !== normalized.length) throw new Error('allowlist contains duplicate application names')
  if (normalized.length > 0) configuredApps(normalized)
  return normalized
}
