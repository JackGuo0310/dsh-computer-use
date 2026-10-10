import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTHORIZATION_MAX_IDLE_TTL_SECONDS,
  AUTHORIZATION_MAX_SESSION_TTL_SECONDS,
  HOST_BUNDLE_ID,
  STARTUP_TIMEOUT_MS,
  buildPrivateWorkerOptions,
} from '../src/driver-options.js'

const options = buildPrivateWorkerOptions('C:\\managed\\cua-driver.exe')

test('worker options carry every field the worker reads, at every level', () => {
  // These are the only fields the worker consumes; a misspelled key would be
  // kept as an extra field and the real option would stay at its default. The
  // nested records are checked the same way, because a wrong key there produced
  // an `undefined` field the FFI writer then refused to serialize at startup.
  assert.deepEqual(Object.keys(options).sort(), [
    'binaryPath', 'configuredDriver', 'environment', 'hostBundleId',
    'inheritStderr', 'shutdownTimeoutMs', 'startupTimeoutMs',
  ])
  assert.deepEqual(Object.keys(options.configuredDriver).sort(), ['authorization', 'claudeCodeCompatibility'])
  assert.deepEqual(Object.keys(options.configuredDriver.authorization).sort(), [
    'allowedModes', 'compatibilityCapabilityManifestPath', 'compatibilityMode',
    'maxIdleTtlSeconds', 'maxSessionTtlSeconds', 'unrestrictedAcknowledged',
  ])
  // The SDK's own defaults contribute that undefined optional path; a bounded
  // compatibility mode is what would require it, and this plugin never sets one.
  assert.equal(options.configuredDriver.authorization.compatibilityCapabilityManifestPath, undefined)
  assert.equal(options.binaryPath, 'C:\\managed\\cua-driver.exe')
  assert.equal(options.hostBundleId, HOST_BUNDLE_ID)
  assert.equal(options.startupTimeoutMs, BigInt(STARTUP_TIMEOUT_MS))
  assert.equal(options.inheritStderr, false)
  assert.equal(typeof options.shutdownTimeoutMs, 'bigint')
})

test('the authorization ceiling is Standard-only and not unrestricted', () => {
  const { authorization } = options.configuredDriver
  assert.deepEqual([...authorization.allowedModes], [0], 'only SessionPermissionMode.Standard may be allowed')
  assert.equal(authorization.compatibilityMode, 0)
  assert.equal(authorization.unrestrictedAcknowledged, false)
  assert.equal(authorization.maxSessionTtlSeconds, AUTHORIZATION_MAX_SESSION_TTL_SECONDS)
  assert.equal(authorization.maxIdleTtlSeconds, AUTHORIZATION_MAX_IDLE_TTL_SECONDS)
  assert.equal(options.configuredDriver.claudeCodeCompatibility, false)
})

test('no environment variable is embedded, because the worker refuses unlisted ones', () => {
  // Passing RUST_LOG made the worker reject the whole configuration with
  // `environment variable RUST_LOG is not in the private-worker safe allowlist`.
  assert.deepEqual([...options.environment], [])
})

test('the SDK record factories accept wrong types, so these assertions are the only guard', async () => {
  const { PrivateWorkerOptions, RuntimeAuthorizationOptions } = await import('@trycua/cua-driver')
  // The factories only merge `defaults()` with the partial, so a number where
  // the contract requires a bigint is kept as a number here and a misspelled key
  // is kept as an ignored extra field. Nothing fails until the worker reads it.
  const wrongType = PrivateWorkerOptions.create({ binaryPath: 'x', hostBundleId: 'y', startupTimeoutMs: 15_000 })
  assert.equal(typeof wrongType.startupTimeoutMs, 'number')
  assert.equal('misspelled' in PrivateWorkerOptions.create({ binaryPath: 'x', hostBundleId: 'y', misspelled: true }), true)
  const badMode = RuntimeAuthorizationOptions.create({ allowedModes: [99], compatibilityMode: 99, unrestrictedAcknowledged: true })
  assert.deepEqual([...badMode.allowedModes], [99], 'an out-of-range permission mode is not rejected')
})
