// End-to-end driver installation against the genuine official archive, using a
// throwaway home directory. Nothing is written outside it.
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { getDriverPaths, getDriverStatus, installDriver, DRIVER_VERSION } from '../src/driver-install.js'

const ARCHIVE = process.argv[2]
const home = await mkdtemp(join(tmpdir(), 'cua-install-test-'))
const paths = getDriverPaths({ home })

const digest = await new Promise((resolve, reject) => {
  const hash = createHash('sha256')
  createReadStream(ARCHIVE).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
})
console.log('checksum match :', digest === paths.checksum)
console.log('status before  :', (await getDriverStatus({ home })).installed)

const result = await installDriver({
  options: { home },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    url: `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${DRIVER_VERSION}/${paths.asset}`,
    headers: { get: () => null },
    body: Readable.toWeb(createReadStream(ARCHIVE)),
  }),
})
console.log('status after   :', result.installed, result.installedVersion, 'runtimeVerified=' + result.runtimeVerified)
const installed = (await readdir(paths.directory)).sort()
console.log('installed files:', installed.join(', '))
for (const name of installed) console.log(`  ${name}: ${(await stat(join(paths.directory, name))).size} bytes`)
const again = await installDriver({ options: { home }, fetchImpl: async () => { throw new Error('must not refetch') } })
console.log('reinstall is a no-op:', again.installed === true)

await rm(home, { recursive: true, force: true })