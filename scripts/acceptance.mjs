/**
 * Live acceptance run for the safe-win provider, against a window the operator
 * has explicitly prepared. It drives the shipped helper over the same JSON-lines
 * protocol the plugin uses and refuses to deliver an action without a typed
 * confirmation, so an accidental run cannot click anything.
 *
 * Usage:
 *   node scripts/acceptance.mjs <hwnd> [--invoke <index> --action <Invoke|Select|Toggle>]
 *
 * Without --invoke the script only inspects and observes, which is read-only.
 * The script never invents a window handle: it must be given one.
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { HelperClient } from '../src/helper-client.js'
import { ObservationGate, configuredApps, validateWindow } from '../src/policy.js'

const args = process.argv.slice(2)
const hwnd = Number(args[0])
const invokeIndex = args.indexOf('--invoke') >= 0 ? Number(args[args.indexOf('--invoke') + 1]) : null
const action = args.includes('--action') ? args[args.indexOf('--action') + 1] : 'Invoke'
if (!Number.isSafeInteger(hwnd) || hwnd <= 0) {
  console.error('usage: node scripts/acceptance.mjs <hwnd> [--invoke <index> --action <action>]')
  process.exit(2)
}

const helperDll = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'publish', 'ComputerUse.Helper.dll')
const client = await HelperClient.start('dotnet', [helperDll])

try {
  const identity = validateWindow(await client.call('inspect', { hwnd }), new Set(configuredApps(['notepad.exe'])))
  console.log('inspect  ', JSON.stringify(identity))

  const observation = await client.call('observe', { hwnd: identity.hwnd })
  const elements = Array.isArray(observation?.elements) ? observation.elements : []
  console.log(`observe   visited ${elements.length} reportable controls`)
  for (const [position, element] of elements.entries()) {
    const patterns = Array.isArray(element?.patterns) ? element.patterns : []
    console.log(`  [${position}] ${element?.type} "${element?.name}" id=${element?.automationId || '-'} [${patterns.join(',')}]`)
  }
  if (elements.length === 0) {
    console.log('\nNo actionable control. The window exposes no button, checkbox, menu item, tab or list item.')
    console.log('Do not force an action on a window that shows nothing; choose another target.')
    process.exitCode = 1
  } else if (invokeIndex === null) {
    console.log('\nRead-only run complete. Re-run with --invoke <index> to request one action.')
  } else {
    if (invokeIndex < 0 || invokeIndex >= elements.length) {
      throw new Error(`--invoke ${invokeIndex} is outside the observed range 0..${elements.length - 1}`)
    }
    const target = elements[invokeIndex]
    const patterns = Array.isArray(target?.patterns) ? target.patterns : []
    console.log(`\nrequested action: ${action} on [${invokeIndex}] ${target?.type} "${target?.name}"`)
    if (!patterns.includes(action)) throw new Error(`that control does not support ${action}; it supports ${patterns.join(',')}`)
    console.log('This will change the application state and cannot be undone.')
    console.log('Type ALLOW exactly to deliver it, anything else to abort.')
    const answer = await new Promise(resolve => {
      const stdin = createInterface({ input: process.stdin })
      stdin.once('line', line => { stdin.close(); resolve(line.trim()) })
    })
    if (answer !== 'ALLOW') {
      console.log('not approved; nothing was delivered')
      process.exitCode = 3
    } else {
      const delivered = await client.call('invoke', { observationId: observation.observationId, index: invokeIndex, action })
      console.log('invoke   ', JSON.stringify(delivered))
      const after = await client.call('observe', { hwnd: identity.hwnd })
      const afterElements = Array.isArray(after?.elements) ? after.elements : []
      console.log(`verify    ${afterElements.length} controls now reportable`)
      for (const [position, element] of afterElements.entries()) {
        console.log(`  [${position}] ${element?.type} "${element?.name}"`)
      }
    }
  }
} catch (error) {
  console.error('acceptance run failed:', error.message)
  process.exitCode = 1
} finally {
  await client.close()
}