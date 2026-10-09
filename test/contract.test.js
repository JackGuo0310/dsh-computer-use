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