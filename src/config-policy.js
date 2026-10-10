import { configuredApps } from './policy.js'

export function normalizeAllowedApps(input) {
  if (typeof input !== 'string') throw new Error('allowlist must be text')
  const entries = input.split(/[\r\n,;]+/).map(value => value.trim()).filter(Boolean)
  if (entries.length > 64) throw new Error('allowlist cannot contain more than 64 applications')
  if (entries.length === 0) return []
  const normalized = entries.map(value => value.toLowerCase())
  if (new Set(normalized).size !== normalized.length) throw new Error('allowlist contains duplicate application names')
  configuredApps(normalized)
  return normalized
}
