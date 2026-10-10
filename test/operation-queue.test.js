import test from 'node:test'
import assert from 'node:assert/strict'
import { OperationQueue, withTimeout } from '../src/operation-queue.js'

const tick = () => new Promise(resolve => setImmediate(resolve))

/** A deferred the test resolves or rejects explicitly. */
function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('operations run one at a time in submission order', async () => {
  const queue = new OperationQueue()
  const events = []
  const first = deferred()
  const a = queue.run(async () => { events.push('a-start'); await first.promise; events.push('a-end'); return 'a' })
  const b = queue.run(async () => { events.push('b-start'); return 'b' })
  await tick()
  assert.deepEqual(events, ['a-start'], 'the second call must not start while the first is running')
  first.resolve()
  assert.equal(await a, 'a')
  assert.equal(await b, 'b')
  assert.deepEqual(events, ['a-start', 'a-end', 'b-start'])
})

test('a timed-out call quarantines the queue until the worker reports it settled', async () => {
  const queue = new OperationQueue()
  const abandoned = deferred()
  const started = deferred()
  const timedOut = queue.run(async () => { started.resolve(); await abandoned.promise }, { timeoutMs: 10, label: 'slow call' })
  await started.promise
  await assert.rejects(timedOut, /slow call timed out/)
  assert.equal(queue.quarantined, true)
  await assert.rejects(queue.run(async () => 'overlap'), /quarantined/)
  abandoned.resolve()
  await tick()
  assert.equal(queue.quarantined, false)
  assert.equal(await queue.run(async () => 'after'), 'after')
})

test('an aborted call quarantines the queue with the abort reason', async () => {
  const queue = new OperationQueue()
  const abandoned = deferred()
  const started = deferred()
  const controller = new AbortController()
  const aborted = queue.run(async () => { started.resolve(); await abandoned.promise }, { signal: controller.signal })
  await started.promise
  controller.abort(new Error('turn cancelled'))
  await assert.rejects(aborted, /turn cancelled/)
  assert.equal(queue.quarantined, true)
  abandoned.resolve()
  await tick()
  assert.equal(await queue.run(async () => 'recovered'), 'recovered')
})

test('a call that already settled before its abort is not quarantined', async () => {
  const queue = new OperationQueue()
  const controller = new AbortController()
  assert.equal(await queue.run(async () => 'done', { signal: controller.signal }), 'done')
  controller.abort(new Error('late cancel'))
  assert.equal(queue.quarantined, false)
  assert.equal(await queue.run(async () => 'still usable'), 'still usable')
})

test('a call refused by an already-aborted signal never reaches the driver', async () => {
  const queue = new OperationQueue()
  let dispatches = 0
  const controller = new AbortController()
  controller.abort(new Error('cancelled before dispatch'))
  await assert.rejects(queue.run(async () => { dispatches += 1 }, { signal: controller.signal }), /cancelled before dispatch/)
  assert.equal(dispatches, 0)
  assert.equal(queue.quarantined, false, 'refusing before dispatch must not quarantine the runtime')
})

test('a rejected operation keeps the queue usable and releases the next call', async () => {
  const queue = new OperationQueue()
  const failed = queue.run(async () => { throw new Error('driver refused') })
  const next = queue.run(async () => 'ok')
  await assert.rejects(failed, /driver refused/)
  assert.equal(await next, 'ok')
  assert.equal(queue.quarantined, false)
})

test('close refuses new calls, drains abandoned ones, and disposes once', async () => {
  const queue = new OperationQueue()
  const abandoned = deferred()
  let dispatches = 0
  const timedOut = queue.run(async () => { dispatches += 1; await abandoned.promise }, { timeoutMs: 5, label: 'stuck call' })
  await assert.rejects(timedOut, /stuck call timed out/)
  const generation = queue.generation
  const closing = queue.close(async () => { dispatches += 1; return 'closed' })
  assert.equal(queue.closed, true)
  assert.notEqual(queue.generation, generation, 'closing must invalidate the generation')
  await assert.rejects(queue.run(async () => 'late'), /closed/)
  abandoned.resolve()
  assert.equal(await closing, 'closed')
  assert.equal(dispatches, 2)
  assert.equal(await queue.close(async () => { dispatches += 1 }), 'closed', 'a second close must not dispose again')
  assert.equal(dispatches, 2)
})

test('a driver that never settles still lets the drain budget expire and shutdown proceed', async () => {
  const queue = new OperationQueue()
  const stuck = queue.run(async () => new Promise(() => {}), { timeoutMs: 5, label: 'never settles' })
  await assert.rejects(stuck, /never settles timed out/)
  assert.equal(queue.quarantined, true)
  assert.equal(await queue.close(async () => 'shutdown attempted'), 'shutdown attempted')
})

test('withTimeout reports the abort reason and leaves the queue unquarantined when unused', async () => {
  const controller = new AbortController()
  const pending = withTimeout(new Promise(() => {}), 60_000, 'label', controller.signal)
  controller.abort(new Error('explicit reason'))
  await assert.rejects(pending, /explicit reason/)
  await assert.rejects(withTimeout(new Promise(() => {}), 5, 'bounded'), /bounded timed out/)
})
