import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  REGISTRY_PACKAGE,
  matchingVersion,
  parseVersion,
  publishedVersions,
  registryPlan,
  registrySetup,
  runningDshVersion,
} from '../src/registry-setup.js'

const published = ['0.1.6-alpha.1', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-alpha.2']

test('a version splits into its release core and prerelease identifiers', () => {
  assert.deepEqual(parseVersion('0.2.1-alpha.2'), { core: '0.2.1', prerelease: ['alpha', '2'] })
  assert.deepEqual(parseVersion('1.2.3'), { core: '1.2.3', prerelease: [] })
  assert.equal(parseVersion('latest'), undefined)
  assert.equal(parseVersion(''), undefined)
})

test('the registry pairs with the exact running Harness version, never a newer build of the line', () => {
  // The package pins `@deepseek-ai/dsh-brand` to its own version, so a newer
  // sibling would demand a brand this profile does not carry.
  assert.equal(matchingVersion('0.2.1-alpha.1', published), '0.2.1-alpha.1', 'the exact build wins')
  assert.equal(matchingVersion('0.2.0-rc.2', published), '0.2.0-rc.2', 'an exact published version wins over its siblings')
  assert.equal(matchingVersion('0.2.1-alpha.3', published), '0.2.1-alpha.2', 'an unpublished exact version falls back within its line')
  assert.equal(matchingVersion('0.2.1', published), '0.2.1-alpha.2', 'a release core still takes its newest prerelease')
  assert.equal(matchingVersion('9.9.9', published), undefined, 'no other release line is offered')
  assert.equal(matchingVersion(undefined, published), undefined)
  assert.equal(matchingVersion('0.2.1-alpha.1', []), undefined, 'an unreachable registry resolves nothing')
})

test('a prerelease sorts below its release and numerically within its identifiers', () => {
  assert.equal(matchingVersion('0.2.1', ['0.2.1', '0.2.1-alpha.9']), '0.2.1')
  assert.equal(matchingVersion('0.2.1', ['0.2.1-alpha.9', '0.2.1-alpha.10']), '0.2.1-alpha.10')
  assert.equal(matchingVersion('0.2.1', ['0.2.1-beta.1', '0.2.1-alpha.9']), '0.2.1-beta.1')
})

test('the plan carries the copy-ready command and patch row for this profile', () => {
  const plan = registryPlan({ dshVersion: '0.2.1-alpha.1', profile: 'web', published })
  assert.equal(plan.spec, `${REGISTRY_PACKAGE}@0.2.1-alpha.1`)
  assert.equal(plan.command, `dsh plugin --profile web add ${REGISTRY_PACKAGE}@0.2.1-alpha.1`)
  assert.equal(plan.patch, `- insert:\n    - id: computer-use\n      name: '${REGISTRY_PACKAGE}'`)
  assert.equal(plan.version, '0.2.1-alpha.1')
  assert.equal(plan.exact, true)
  assert.equal(plan.verified, true)
})

test('a plan without an exact published build is reported as inexact', () => {
  const plan = registryPlan({ dshVersion: '0.2.1-alpha.3', profile: 'web', published })
  assert.equal(plan.version, '0.2.1-alpha.2')
  assert.equal(plan.exact, false, 'the panel must be able to warn about a brand mismatch')
})

test('an unreachable registry still pins the running Harness version', () => {
  // npm is only a confirmation: the lockstep release rule makes the running
  // version the answer, so a failed lookup must not drop the pin.
  const plan = registryPlan({ dshVersion: '0.2.1-alpha.1', profile: 'web', published: [] })
  assert.equal(plan.version, '0.2.1-alpha.1')
  assert.equal(plan.spec, `${REGISTRY_PACKAGE}@0.2.1-alpha.1`)
  assert.equal(plan.verified, false, 'the panel reports the unconfirmed pin')
  assert.equal(plan.exact, true)
})

test('an unresolvable version still yields a runnable command', () => {
  const plan = registryPlan({ dshVersion: undefined, profile: 'work', published: [] })
  assert.equal(plan.spec, REGISTRY_PACKAGE, 'the panel must not invent a version')
  assert.equal(plan.command, `dsh plugin --profile work add ${REGISTRY_PACKAGE}`)
  assert.equal(plan.version, null)
})

test('the running Harness version comes from the manifest that owns the entry script', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-registry-setup-'))
  try {
    const harness = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(join(harness, 'lib'), { recursive: true })
    await writeFile(join(harness, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-alpha.1' }))
    await writeFile(join(harness, 'lib', 'bin.js'), '')
    assert.equal(await runningDshVersion(join(harness, 'lib', 'bin.js')), '0.2.1-alpha.1')
    assert.equal(await runningDshVersion(join(root, 'unrelated.js')), undefined, 'no Harness manifest means no version')
    assert.equal(await runningDshVersion(undefined), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a registry that cannot be reached reports no published versions', async () => {
  assert.deepEqual(await publishedVersions(async () => ({ ok: true, json: async () => ({ versions: { '0.2.1-alpha.2': {} } }) })), ['0.2.1-alpha.2'])
  assert.deepEqual(await publishedVersions(async () => ({ ok: false })), [])
  assert.deepEqual(await publishedVersions(async () => { throw new Error('offline') }), [])
})

test('the setup payload reads the profile from the environment and never throws offline', async () => {
  const setup = await registrySetup({
    installed: false,
    env: { DSH_PROFILE: 'work', DSH_PROFILE_DIR: 'C:\\profiles\\work' },
    fetchImpl: async () => { throw new Error('offline') },
  })
  assert.equal(setup.installed, false)
  assert.equal(setup.profile, 'work')
  assert.equal(setup.profileDir, 'C:\\profiles\\work')
  assert.equal(setup.published, 0)
  assert.equal(setup.command, `dsh plugin --profile work add ${REGISTRY_PACKAGE}`)
})
