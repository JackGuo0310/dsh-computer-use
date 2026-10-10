// Read-only: do snapshot elements carry a bounding frame we can act on?
import { startCuaRuntime } from '../src/cua-adapter.js'
import { configuredApps } from '../src/policy.js'

const runtime = await startCuaRuntime()
try {
  const targets = await runtime.listTargets(configuredApps([process.env.DSH_CUA_LIVE_APP ?? 'notepad.exe']))
  if (targets.length === 0) { console.log('no target window'); process.exitCode = 2 }
  const snapshot = await runtime.observe(targets[0], { includeScreenshot: true })
  console.log('window bounds:', JSON.stringify(snapshot.target.bounds))
  console.log('screenshot:', JSON.stringify(snapshot.images.map(i => ({ mimeType: i.mimeType, bytes: i.data.length }))))
  console.log('\nelements with a frame:')
  for (const element of snapshot.elements) {
    console.log(`  ${String(element.index).padStart(2)} ${element.role.padEnd(9)} ${JSON.stringify(element.frame ?? null)} ${JSON.stringify(element.label).slice(0, 40)}`)
  }
  const framed = snapshot.elements.filter(element => element.frame !== undefined).length
  console.log(`\n${framed}/${snapshot.elements.length} elements carry a frame`)
} finally {
  await runtime.close()
  console.log('runtime closed')
}