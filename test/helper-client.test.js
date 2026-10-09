import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { HelperClient } from '../src/helper-client.js'

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  killed = false
  exitCode = null
  signalCode = null
  constructor(responder) {
    super()
    let buffer = ''
    this.stdin.on('data', data => {
      buffer += data.toString()
      if (!buffer.includes('\n')) return
      const [line] = buffer.split('\n')
      buffer = ''
      responder(JSON.parse(line), this)
    })
  }
  kill() { this.killed = true; this.exitCode = 1; this.emit('exit', 1) }
}

test('correlates response to the one outstanding request', async () => {
  const child = new FakeChild((request, process) => process.stdout.write(JSON.stringify({ id: request.id, result: { version: 1 }, error: null }) + '\n'))
  const client = new HelperClient(child)
  assert.deepEqual(await client.call('hello', {}), { version: 1 })
  await client.close()
  assert.equal(child.killed, true)
})

test('rejects unexpected ids and kills the helper', async () => {
  const child = new FakeChild((_request, process) => process.stdout.write('{"id":"different","result":{},"error":null}\n'))
  const client = new HelperClient(child)
  await assert.rejects(client.call('hello', {}), /invalid helper response/)
  assert.equal(child.killed, true)
})

test('abort kills helper rather than retrying ambiguous delivery', async () => {
  const child = new FakeChild(() => {})
  const client = new HelperClient(child)
  const controller = new AbortController()
  const pending = client.call('invoke', {}, controller.signal)
  controller.abort(new Error('cancelled'))
  await assert.rejects(pending, /cancelled/)
  assert.equal(child.killed, true)
})

test('oversized response fails closed', async () => {
  const child = new FakeChild((_request, process) => process.stdout.write('x'.repeat(128_001) + '\n'))
  const client = new HelperClient(child)
  await assert.rejects(client.call('hello', {}), /oversized helper response/)
  assert.equal(child.killed, true)
})
