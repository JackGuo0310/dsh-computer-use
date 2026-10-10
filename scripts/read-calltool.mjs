// Read-only probe: does the MCP tool route work, and what does it report?
import { buildPrivateWorkerOptions } from '../src/driver-options.js'
import { getDriverPaths } from '../src/driver-install.js'
import { CuaDriver } from '@trycua/cua-driver'

const signal = new AbortController().signal
const driver = CuaDriver.createPrivateWorker(buildPrivateWorkerOptions(getDriverPaths().executable))
const call = async (name, args = {}) => {
  const result = await driver.callTool(name, JSON.stringify(args), { signal })
  const raw = JSON.parse(result.rawJson)
  console.log(`\n=== ${name} ===`)
  console.log('isError:', result.isError, '| text:', String(result.text).slice(0, 160))
  console.log('action:', JSON.stringify(raw.action ?? result.action ?? null))
  console.log('verification:', JSON.stringify(raw.verification ?? null)?.slice(0, 200))
  console.log('degraded:', result.degraded)
}
try {
  await call('get_config')
  await call('check_permissions')
  await call('get_screen_size')
} catch (error) {
  console.log('ERR', error.tag, JSON.stringify(error.inner ?? error.message))
} finally {
  await driver.shutdown()
}