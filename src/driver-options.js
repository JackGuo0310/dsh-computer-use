/**
 * Build the private-worker startup options and pin them against the pinned SDK.
 *
 * `RuntimeAuthorizationOptions.create()` and `PrivateWorkerOptions.create()` are
 * generated record constructors. They merge `defaults()` with the given partial
 * and freeze the result; they validate nothing. A number where the contract
 * declares `bigint`, or an out-of-range permission mode, is accepted here and
 * only matters once the worker reads it. A misspelled key is kept as an extra
 * field the worker ignores, so the intended option silently stays at its default
 * — for the authorization record that means the ceiling is not applied at all.
 * Construction therefore lives in this one pure function, so a test can assert
 * the exact record through the real SDK without starting a worker.
 *
 * This module imports `@trycua/cua-driver`; `src/snapshot-policy.js` and
 * `src/operation-queue.js` deliberately do not, so the rest of the policy stays
 * testable without the native addon.
 */

import {
  EmbeddedEnvironmentVariable,
  PrivateWorkerOptions,
  RuntimeAuthorizationOptions,
  SessionPermissionMode,
} from '@trycua/cua-driver'
import { SHUTDOWN_TIMEOUT_MS } from './operation-queue.js'

/** Host bundle identity the worker attributes this embedding to. */
export const HOST_BUNDLE_ID = 'ai.deepseek.dsh.computer-use'
/** Ceiling for private-worker startup. */
export const STARTUP_TIMEOUT_MS = 15_000
/** Authorization ceiling: only the standard permission mode is reachable. */
export const AUTHORIZATION_MAX_SESSION_TTL_SECONDS = 900n
/** Idle ceiling after which the worker session is abandoned. */
export const AUTHORIZATION_MAX_IDLE_TTL_SECONDS = 300n

/**
 * Build the exact options passed to `CuaDriver.createPrivateWorker()`.
 *
 * The authorization record restricts the runtime to `Standard` permission with
 * no unrestricted acknowledgement, so neither this plugin nor a compromised
 * caller can escalate the worker to bounded-manifest or unrestricted modes.
 *
 * @param binaryPath - Absolute path to the managed `cua-driver.exe`.
 * @returns The SDK record to pass to the private-worker factory.
 */
export function buildPrivateWorkerOptions(binaryPath) {
  const authorization = RuntimeAuthorizationOptions.create({
    allowedModes: [SessionPermissionMode.Standard],
    compatibilityMode: SessionPermissionMode.Standard,
    unrestrictedAcknowledged: false,
    maxSessionTtlSeconds: AUTHORIZATION_MAX_SESSION_TTL_SECONDS,
    maxIdleTtlSeconds: AUTHORIZATION_MAX_IDLE_TTL_SECONDS,
  })
  return PrivateWorkerOptions.create({
    binaryPath,
    hostBundleId: HOST_BUNDLE_ID,
    startupTimeoutMs: BigInt(STARTUP_TIMEOUT_MS),
    shutdownTimeoutMs: BigInt(SHUTDOWN_TIMEOUT_MS),
    configuredDriver: {
      claudeCodeCompatibility: false,
      authorization,
    },
    environment: [EmbeddedEnvironmentVariable.create({ key: 'RUST_LOG', value: 'warn' })],
    inheritStderr: false,
  })
}
