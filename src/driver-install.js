import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { arch, homedir, platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const DRIVER_VERSION = '0.28.0'
const WINDOWS_X64_SHA256 = '9db2096df8d80da4e73ffb797947dcdfab2a362faddd9d1b77682c77aace5aa9'
const WINDOWS_ARM64_SHA256 = 'd8059fa1e963169258e5086029c7d0627bb76bd91703f040aff5286b0cd1b1f5'
const RELEASE = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${DRIVER_VERSION}`
const BINARIES = ['cua-driver.exe', 'cua-driver-uia.exe']
const MARKER = 'release.sha256'
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 180 * 1024 * 1024

/** Resolve the version-pinned, private release location without inspecting the desktop. */
export function getDriverPaths({ os = platform(), cpu = arch(), home = homedir() } = {}) {
  if (os !== 'win32') return { supported: false, reason: 'windows-required' }
  const suffix = cpu === 'x64' ? 'x86_64' : cpu === 'arm64' ? 'arm64' : undefined
  if (!suffix) return { supported: false, reason: 'architecture-unsupported' }
  const directory = join(home, '.dsh', 'computer-use', `cua-driver-${DRIVER_VERSION}-${suffix}`)
  return {
    supported: true,
    executable: join(directory, 'cua-driver.exe'),
    directory,
    checksum: cpu === 'x64' ? WINDOWS_X64_SHA256 : WINDOWS_ARM64_SHA256,
    asset: `cua-driver-rs-${DRIVER_VERSION}-windows-${suffix}-binary.zip`,
  }
}

async function isComplete(paths) {
  try {
    const marker = await lstat(join(paths.directory, MARKER))
    if (!marker.isFile() || marker.isSymbolicLink() || (await readFile(join(paths.directory, MARKER), 'utf8')).trim() !== paths.checksum) return false
    for (const name of BINARIES) {
      const file = join(paths.directory, name)
      const info = await lstat(file)
      if (!info.isFile() || info.size < 1024 * 1024) return false
      const handle = await open(file, 'r')
      try {
        const header = Buffer.alloc(2)
        if ((await handle.read(header, 0, 2, 0)).bytesRead !== 2 || header.readUInt16LE(0) !== 0x5a4d) return false
      } finally { await handle.close() }
    }
    return true
  } catch { return false }
}

/** Report only a complete managed release; the npm SDK does not ship an executable. */
export async function getDriverStatus(options = {}) {
  const paths = getDriverPaths(options)
  if (!paths.supported) return { installed: false, supported: false, reason: paths.reason, version: DRIVER_VERSION }
  if (await isComplete(paths)) return { installed: true, supported: true, version: DRIVER_VERSION, installedVersion: DRIVER_VERSION, path: paths.executable, managed: true, runtimeVerified: false }
  return { installed: false, supported: true, version: DRIVER_VERSION, installedVersion: null, path: paths.executable }
}

function runPowerShell(script, args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, ...args], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout))
  })
}

/** Download a pinned official archive; never invoke the binary or access the desktop. */
export async function installDriver({ fetchImpl = fetch, options = {} } = {}) {
  const paths = getDriverPaths(options)
  if (!paths.supported) throw new Error(`Cua Driver installation is not supported: ${paths.reason}`)
  const current = await getDriverStatus(options)
  if (current.installed) return current

  const timeout = AbortSignal.timeout(60_000)
  const response = await fetchImpl(`${RELEASE}/${paths.asset}`, { redirect: 'follow', signal: timeout })
  if (!response.ok || !response.body) throw new Error(`Cua Driver download failed: HTTP ${response.status}`)
  if (response.url && !/^https:\/\/github\.com\/trycua\/cua\/releases\/download\/|^https:\/\/release-assets\.githubusercontent\.com\//.test(response.url)) throw new Error('Unexpected Cua Driver download origin')
  if (Number(response.headers?.get('content-length')) > MAX_ARCHIVE_BYTES) throw new Error('Cua Driver archive exceeds size limit')
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-cua-driver-'))
  try {
    const archivePath = join(scratch, paths.asset)
    let downloaded = 0
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      downloaded += chunk.length
      callback(downloaded > MAX_ARCHIVE_BYTES ? new Error('Cua Driver archive exceeds size limit') : null, chunk)
    } })
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(archivePath, { flags: 'wx' }), { signal: timeout })
    const archive = await readFile(archivePath)
    if (createHash('sha256').update(archive).digest('hex') !== paths.checksum) throw new Error('Cua Driver archive checksum does not match the pinned official release')

    const extraction = join(scratch, 'extracted')
    await mkdir(extraction)
    const script = `param([string]$Archive, [string]$Destination)
Add-Type -AssemblyName System.IO.Compression
$zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $entries = @($zip.Entries | Where-Object { $_.Name -ne '' })
  if ($entries.Count -ne 2) { throw 'Unexpected Cua Driver archive layout' }
  $total = [int64]0
  foreach ($entry in $entries) {
    $total += $entry.Length
    if ($total -gt ${MAX_EXTRACTED_BYTES}) { throw 'Cua Driver extracted size exceeds limit' }
  }
  $required = @('cua-driver.exe', 'cua-driver-uia.exe')
  foreach ($entry in $entries) {
    if ($entry.FullName -ne $entry.Name -or $entry.Name -notmatch '^[a-zA-Z0-9_.-]+$' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe Cua Driver archive entry' }
  }
  foreach ($name in $required) {
    $matches = @($entries | Where-Object { $_.Name -eq $name })
    if ($matches.Count -ne 1) { throw "Cua Driver archive must contain $name exactly once at its root" }
  }
  foreach ($entry in $entries) {
    $target = [System.IO.Path]::Combine($Destination, $entry.Name)
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
  }
} finally { $zip.Dispose() }`
    await runPowerShell(script, [archivePath, extraction])
    for (const name of BINARIES) {
      const file = join(extraction, name)
      const binary = await readFile(file)
      if (binary.length < 1024 * 1024 || binary.readUInt16LE(0) !== 0x5a4d) throw new Error(`Cua Driver archive contains an invalid ${name}`)
    }
    for (const name of await readdir(extraction)) {
      const info = await lstat(join(extraction, name))
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Cua Driver archive contains an unsupported file type')
    }
    await writeFile(join(extraction, MARKER), `${paths.checksum}\n`, { flag: 'wx' })
    await mkdir(dirname(paths.directory), { recursive: true })
    // Never overwrite an existing incomplete release: preserve it for manual investigation.
    try { await access(paths.directory); throw new Error(`Incomplete Cua Driver release exists at ${paths.directory}`) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(extraction, paths.directory)
    return { installed: true, supported: true, version: DRIVER_VERSION, installedVersion: DRIVER_VERSION, path: paths.executable, managed: true, runtimeVerified: false }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
