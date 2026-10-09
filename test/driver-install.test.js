import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DRIVER_VERSION, getDriverPaths, getDriverStatus, installDriver } from '../src/driver-install.js'

const windows = home => ({ os: 'win32', cpu: 'x64', home })

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
    assert.equal((await getDriverStatus(options)).installed, true)
    await writeFile(join(paths.directory, 'release.sha256'), 'wrong\n')
    assert.equal((await getDriverStatus(options)).installed, false)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('unsupported installation fails without fetching', async () => {
  let fetched = false
  await assert.rejects(installDriver({ options: { os: 'linux' }, fetchImpl: () => { fetched = true } }), /not supported/)
  assert.equal(fetched, false)
})
