import { spawn } from 'node:child_process'

if (process.env.DSH_CUA_LIVE !== '1') {
  console.error('refusing to touch the desktop: set DSH_CUA_LIVE=1')
  process.exit(1)
}

const { configuredApps } = await import('../src/policy.js')
const { startCuaRuntime } = await import('../src/cua-adapter.js')

const runtime = await startCuaRuntime()
try {
  const applications = await runtime.listApplications()
  console.log('running applications:', applications.length)
  const notepad = applications.find(app => app.name === 'notepad.exe')
  console.log('notepad identity:', JSON.stringify(notepad))
  const withPath = applications.find(app => app.path !== undefined)
  const withoutPath = applications.find(app => app.path === undefined)
  console.log('sample with path:', JSON.stringify(withPath))
  console.log('sample without path:', JSON.stringify(withoutPath))

  // A path entry matches only windows of that exact executable, and the same
  // entry as a filename does not match the same app.
  const withPathWindows = withPath === undefined ? [] : await runtime.listTargets(configuredApps([withPath.path]))
  console.log('path entry windows:', withPathWindows.length, 'all from that path:', withPathWindows.length > 0 && withPathWindows.every(w => w.path === withPath.path))
  if (withPath !== undefined) {
    const asName = await runtime.listTargets(configuredApps([withPath.name]))
    console.log('the same executable as a filename entry matched:', asName.length)
  }
  if (withoutPath !== undefined) {
    const byName = await runtime.listTargets(configuredApps([withoutPath.name]))
    console.log('pathless app matched by filename:', byName.length)
  }
} finally {
  await runtime.close()
  console.log('runtime closed')
}