// Read-only: enumerate the driver's own tool catalog and typed action surface.
import { buildPrivateWorkerOptions } from '../src/driver-options.js'
import { getDriverPaths } from '../src/driver-install.js'
import { CuaDriver } from '@trycua/cua-driver'

const driver = CuaDriver.createPrivateWorker(buildPrivateWorkerOptions(getDriverPaths().executable))
const signal = new AbortController().signal
try {
  const catalog = JSON.parse(await driver.listToolsJson({ signal }))
  console.log('tool count:', catalog.tools.length)
  console.log('\n--- every tool and its parameters ---')
  for (const tool of catalog.tools) {
    const props = Object.entries(tool.inputSchema?.properties ?? {})
      .map(([name, schema]) => `${name}:${schema?.type ?? '?'}${schema?.enum ? `=${schema.enum.join('|')}` : ''}`)
    console.log(`${tool.name}(${props.join(', ')})`)
  }
} catch (error) {
  console.log('ERR', error.tag, JSON.stringify(error.inner ?? error.message))
} finally {
  await driver.shutdown()
}