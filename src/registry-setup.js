import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * The exclusive computer-use provider registry, and the two steps that mount it.
 *
 * This module is deliberately pure apart from {@link runningDshVersion}: the
 * panel shows a command a person runs, because neither automatic path exists.
 * The Host plugin manager activates only bundles that ship a patch file, so it
 * rolls an install of this package back; and a plugin must not write the
 * profile's own patch layer. What is left is an exact, copy-ready command whose
 * version is resolved from the running Harness rather than pinned in source.
 */

/** Package that supplies the `computerUse` service. */
export const REGISTRY_PACKAGE = '@deepseek-ai/dsh-computer-use'

/** The Harness package whose version the registry must match. */
const HARNESS_PACKAGE = '@deepseek-ai/dsh'
const MANIFEST = 'package.json'
const MAX_ANCESTORS = 6
const REGISTRY_ORIGIN = 'https://registry.npmjs.org'
/** How long the panel waits for the published-version list before answering anyway. */
const REGISTRY_TIMEOUT_MS = 5000

/**
 * Split a version into its release core and its prerelease identifiers.
 *
 * @param version - Version string such as `0.2.1-alpha.2`.
 * @returns The parts, or undefined when the string is not a version.
 */
export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(version).trim())
  if (match === null) return undefined
  return {
    core: `${match[1]}.${match[2]}.${match[3]}`,
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Compare one prerelease identifier pair, numeric identifiers first. */
function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Number(left) - Number(right)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Order two prerelease lists; an empty list (a release) sorts above any prerelease. */
function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === undefined) return -1
    if (right[index] === undefined) return 1
    const order = compareIdentifier(left[index], right[index])
    if (order !== 0) return order
  }
  return 0
}

/**
 * The published registry version that pairs with the running Harness.
 *
 * The registry is released in lockstep with the Harness and pins it as a peer:
 * `@deepseek-ai/dsh-computer-use@0.2.1-alpha.1` requires
 * `@deepseek-ai/dsh-brand@0.2.1-alpha.1`, which is exactly the brand a Harness
 * `0.2.1-alpha.1` already carries. Taking a newer build of the same release line
 * would demand a brand the profile does not have — pnpm would then install a
 * second copy of a Host package. So the exact running version wins whenever it
 * is published, and only an unpublished exact version falls back to the newest
 * sibling of the same core (reported as inexact by {@link registryPlan}).
 *
 * @param dshVersion - Version of the running Harness, or undefined.
 * @param published - Published registry versions.
 * @returns The matching version, or undefined when nothing matches.
 */
export function matchingVersion(dshVersion, published) {
  const running = parseVersion(dshVersion ?? '')
  if (running === undefined) return undefined
  const exact = running.prerelease.length === 0 ? running.core : `${running.core}-${running.prerelease.join('.')}`
  if (published.includes(exact)) return exact
  let best
  for (const candidate of published) {
    const parsed = parseVersion(candidate)
    if (parsed === undefined || parsed.core !== running.core) continue
    if (best === undefined || comparePrerelease(parsed.prerelease, best.prerelease) > 0) best = parsed
  }
  if (best === undefined) return undefined
  return best.prerelease.length === 0 ? best.core : `${best.core}-${best.prerelease.join('.')}`
}

/**
 * The two commands that mount the registry in this profile.
 *
 * The running Harness version *is* the answer, because the registry is released
 * in lockstep with it: npm is asked only to confirm that the build is published
 * (and to supply the newest sibling when it is not). An unreachable registry
 * therefore must not downgrade the command to an unpinned spec — it only sets
 * `verified: false` so the panel can say the pin was not confirmed.
 *
 * @param options - Harness version, profile name, and the published versions.
 * @returns The resolved spec, whether it is the exact Harness version, whether npm confirmed it, and the copy-ready texts.
 */
export function registryPlan({ dshVersion, profile, published }) {
  const running = parseVersion(dshVersion ?? '')
  const wanted = running === undefined ? undefined : running.prerelease.length === 0 ? running.core : `${running.core}-${running.prerelease.join('.')}`
  const verified = published.length > 0
  const version = wanted !== undefined && (!verified || published.includes(wanted)) ? wanted : matchingVersion(dshVersion, published)
  const spec = version === undefined ? REGISTRY_PACKAGE : `${REGISTRY_PACKAGE}@${version}`
  return {
    package: REGISTRY_PACKAGE,
    profile,
    dshVersion: dshVersion ?? null,
    version: version ?? null,
    exact: version !== undefined && version === wanted,
    verified,
    spec,
    command: `dsh plugin --profile ${profile} add ${spec}`,
    patch: `- insert:\n    - id: computer-use\n      name: '${REGISTRY_PACKAGE}'`,
  }
}

/**
 * Version of the Harness this process runs inside.
 *
 * The entry script lives in the installed package (`…/@deepseek-ai/dsh/lib/bin.js`),
 * so walking its ancestors finds the owning manifest without importing any Host
 * package and without a dependency.
 *
 * @param entry - Entry script path; defaults to this process's.
 * @returns The version, or undefined when no Harness manifest owns the script.
 */
export async function runningDshVersion(entry = process.argv[1]) {
  if (typeof entry !== 'string' || entry === '') return undefined
  let directory = dirname(entry)
  for (let depth = 0; depth < MAX_ANCESTORS; depth += 1) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, MANIFEST), 'utf8'))
      if (manifest.name === HARNESS_PACKAGE) return manifest.version
    } catch {
      // A missing or unreadable manifest only means this ancestor is not the package.
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
  return undefined
}

/**
 * Published versions of the registry package.
 *
 * A network failure is not an error here: the panel still shows the command,
 * just without a resolved version. The lookup is also time-boxed, because a
 * hanging registry must not hold the panel open.
 *
 * @param fetchImpl - Fetch implementation; injectable for tests.
 * @returns Published versions, or an empty list.
 */
export async function publishedVersions(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${REGISTRY_ORIGIN}/${REGISTRY_PACKAGE.replace('/', '%2F')}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
    if (response.ok !== true) return []
    const body = await response.json()
    return Object.keys(body?.versions ?? {})
  } catch {
    return []
  }
}

/**
 * Everything the panel needs to explain how to mount the registry.
 *
 * @param options - Whether the service already exists, the environment, and a fetch implementation.
 * @returns The installation plan and the current state.
 */
export async function registrySetup({ installed, env = process.env, fetchImpl = fetch } = {}) {
  const profile = env?.DSH_PROFILE ?? 'web'
  const [dshVersion, published] = await Promise.all([runningDshVersion(), publishedVersions(fetchImpl)])
  return {
    installed: installed === true,
    profile,
    profileDir: env?.DSH_PROFILE_DIR ?? null,
    published: published.length,
    ...registryPlan({ dshVersion, profile, published }),
  }
}
