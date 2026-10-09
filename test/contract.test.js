import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * The helper and the plugin each keep their own copy of the allowed control
 * types and actions. If either side is edited alone, the plugin either refuses
 * a control the helper reported or accepts one the helper filtered out, and in
 * the second case the delivered index addresses the wrong control. These tests
 * read both sources so the drift fails here instead of at acceptance.
 */
const programPath = fileURLToPath(new URL('../native/Program.cs', import.meta.url))
const policyPath = fileURLToPath(new URL('../src/policy.js', import.meta.url))

test('the helper emits element fields in the casing the plugin reads', async () => {
  // An inferred C# member name serializes with its C# casing, which would leave
  // the plugin reading element.type as undefined and reject every control.
  const source = await readFile(programPath, 'utf8')
  const block = source.slice(source.indexOf('elements.Add(new'), source.indexOf('Snapshots[observationId]'))
  for (const field of ['type', 'name', 'automationId', 'password']) {
    assert.match(block, new RegExp(`\\b${field}\\s*=`), `element field "${field}" is not emitted with an explicit name`)
  }
  assert.doesNotMatch(block, /^\s*fingerprint\.Type\s*,/m, 'an inferred member name would serialize as "Type"')
})

test('the plugin reads the element fields the helper emits', async () => {
  const source = await readFile(policyPath, 'utf8')
  for (const field of ['type', 'name', 'automationId', 'password', 'patterns']) {
    assert.match(source, new RegExp(`element\\.${field}\\b`), `the plugin never reads element.${field}`)
  }
})

test('the helper keeps one observation per caller instead of a single slot', async () => {
  const source = await readFile(programPath, 'utf8')
  const observe = source.slice(source.indexOf('private static object Observe'))
  const invoke = source.slice(source.indexOf('private static object Invoke'))
  // A shared slot would cancel another agent's pending action the moment this
  // one observes, which is what the plugin's per-agent isolation depends on.
  assert.doesNotMatch(observe, /Snapshots\.Clear\(\)/, 'observe must not clear every observation')
  assert.match(observe, /ExpireSnapshots\(\)/)
  assert.match(invoke, /Snapshots\.Remove\(id\)/, 'invoke must consume only the addressed observation')
  assert.doesNotMatch(invoke, /Snapshots\.Clear\(\)/, 'invoke must not clear every observation')
})

test('the plugin isolates observations per caller', async () => {
  const source = await readFile(policyPath, 'utf8')
  assert.match(source, /#observations = new Map\(\)/)
  assert.match(source, /#busy = new Set\(\)/)
  // A single slot or a single boolean would make one agent's observe cancel
  // another's pending action.
  assert.doesNotMatch(source, /#observation = null/)
  assert.doesNotMatch(source, /#busy = (true|false)/)
})

async function literals(file, pattern) {
  const source = await readFile(file, 'utf8')
  const line = source.split('\n').find(entry => pattern.test(entry))
  assert.ok(line, `no line matching ${pattern} in ${file}`)
  // The C# side uses double quotes and the JavaScript side single quotes.
  return [...line.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1])
}

test('the helper and the plugin agree on the allowed control types', async () => {
  const helper = await literals(programPath, /AllowedTypes = new/)
  const policy = await literals(policyPath, /const SAFE_TYPES = new Set/)
  assert.deepEqual([...policy].sort(), [...helper].sort())
})

test('the helper and the plugin agree on the allowed actions', async () => {
  const helper = await literals(programPath, /AllowedActions = new/)
  const policy = await literals(policyPath, /const SAFE_PATTERNS = new Set/)
  assert.deepEqual([...policy].sort(), [...helper].sort())
})

test('the helper element cap matches what the plugin accepts', async () => {
  const source = await readFile(programPath, 'utf8')
  const cap = Number(source.match(/MaxElements = (\d+)/)[1])
  const policy = await readFile(policyPath, 'utf8')
  const limit = Number(policy.match(/elements\.length > (\d+)/)[1])
  // The helper must never report more than the plugin will accept.
  assert.equal(limit, cap)
})

test('the response size limits match on both sides', async () => {
  const protocol = await readFile(fileURLToPath(new URL('../native/Protocol.cs', import.meta.url)), 'utf8')
  const helperResponse = Number(protocol.match(/MaxResponseLength = ([\d_]+)/)[1].replaceAll('_', ''))
  const client = await readFile(fileURLToPath(new URL('../src/helper-client.js', import.meta.url)), 'utf8')
  const clientResponse = Number(client.match(/MAX_RESPONSE_BYTES = ([\d_]+)/)[1].replaceAll('_', ''))
  assert.equal(clientResponse, helperResponse)
})

test('the request size limits match on both sides', async () => {
  const protocol = await readFile(fileURLToPath(new URL('../native/Protocol.cs', import.meta.url)), 'utf8')
  const helperRequest = Number(protocol.match(/MaxLineLength = ([\d_]+)/)[1].replaceAll('_', ''))
  const client = await readFile(fileURLToPath(new URL('../src/helper-client.js', import.meta.url)), 'utf8')
  const clientRequest = Number(client.match(/byteLength\(payload\) > ([\d_]+)/)[1].replaceAll('_', ''))
  assert.equal(clientRequest, helperRequest)
})