import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DRIVER_VERSION, getDriverPaths, getDriverStatus, installDriver } from '../src/driver-install.js'

const windows = home => ({ os: 'win32', cpu: 'x64', home })

/** Minimal successful download response; the guards under test read its metadata only. */
const archiveResponse = ({ url, contentLength = '1024' }) => ({
  ok: true,
  status: 200,
  url,
  body: Readable.toWeb(Readable.from([Buffer.alloc(16)])),
  headers: { get: name => (name.toLowerCase() === 'content-length' ? contentLength : null) },
})

test('only supported Windows architectures resolve version-pinned managed release paths', () => {
  const x64 = getDriverPaths(windows('C:\\Users\\fixture'))
  assert.equal(x64.supported, true)
  assert.equal(x64.asset, `cua-driver-rs-${DRIVER_VERSION}-windows-x86_64-binary.zip`)
  assert.equal(x64.checksum.length, 64)
  assert.equal(x64.packageExecutable, undefined)
  assert.equal(getDriverPaths({ ...windows('fixture'), cpu: 'arm64' }).asset.includes('arm64'), true)
  assert.deepEqual(getDriverPaths({ ...windows('fixture'), cpu: 'ia32' }), { supported: false, reason: 'architecture-unsupported' })
  assert.deepEqual(getDriverPaths({ ...windows('fixture'), os: 'linux' }), { supported: false, reason: 'windows-required' })
})

test('status rejects absent, incomplete, or misleading SDK executables', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cua-status-'))
  try {
    const options = windows(home)
    const paths = getDriverPaths(options)
    assert.equal((await getDriverStatus(options)).installed, false)
    await mkdir(paths.directory, { recursive: true })
    await writeFile(paths.executable, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024 * 1024)]))
    assert.equal((await getDriverStatus(options)).installed, false)
    await writeFile(join(paths.directory, 'release.sha256'), `${paths.checksum}\n`)
    assert.equal((await getDriverStatus(options)).installed, false)
    await writeFile(join(paths.directory, 'cua-driver-uia.exe'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024 * 1024)]))
    const complete = await getDriverStatus(options)
    assert.equal(complete.installed, true)
    assert.equal(complete.version, DRIVER_VERSION)
    assert.equal(complete.installedVersion, DRIVER_VERSION)
    assert.equal(complete.runtimeVerified, false, 'a complete release is not an executed driver')
    await writeFile(join(paths.directory, 'release.sha256'), 'wrong\n')
    assert.equal((await getDriverStatus(options)).installed, false)
    assert.equal((await getDriverStatus(options)).installedVersion, null)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('unsupported installation fails without fetching', async () => {
  let fetched = false
  await assert.rejects(installDriver({ options: { os: 'linux' }, fetchImpl: () => { fetched = true } }), /not supported/)
  assert.equal(fetched, false)
})

test('a managed release already installed is reported without downloading', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cua-installed-'))
  try {
    const options = windows(home)
    const paths = getDriverPaths(options)
    await mkdir(paths.directory, { recursive: true })
    for (const name of ['cua-driver.exe', 'cua-driver-uia.exe']) {
      await writeFile(join(paths.directory, name), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024 * 1024)]))
    }
    await writeFile(join(paths.directory, 'release.sha256'), `${paths.checksum}\n`)
    let fetched = false
    const status = await installDriver({ options, fetchImpl: () => { fetched = true } })
    assert.equal(fetched, false)
    assert.equal(status.installed, true)
    assert.equal(status.runtimeVerified, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('an unexpected download origin is refused before the archive is written', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cua-origin-'))
  try {
    const options = windows(home)
    const hostile = archiveResponse({ url: 'https://evil.test/cua-driver.zip' })
    await assert.rejects(
      installDriver({ options, fetchImpl: async () => hostile }),
      /Unexpected Cua Driver download origin/,
    )
    assert.equal((await getDriverStatus(options)).installed, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('an oversized archive is refused before extraction', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cua-size-'))
  try {
    const options = windows(home)
    const official = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${DRIVER_VERSION}/cua-driver-rs-${DRIVER_VERSION}-windows-x86_64-binary.zip`
    const oversized = archiveResponse({ url: official, contentLength: String(512 * 1024 * 1024) })
    await assert.rejects(
      installDriver({ options, fetchImpl: async () => oversized }),
      /exceeds size limit/,
    )
    assert.equal((await getDriverStatus(options)).installed, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('a failed HTTP download reports the status without installing', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cua-http-'))
  try {
    const options = windows(home)
    await assert.rejects(
      installDriver({ options, fetchImpl: async () => ({ ok: false, status: 404 }) }),
      /HTTP 404/,
    )
    assert.equal((await getDriverStatus(options)).installed, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})
