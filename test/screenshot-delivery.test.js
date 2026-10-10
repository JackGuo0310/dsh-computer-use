import test from 'node:test'
import assert from 'node:assert/strict'
import { attachmentStore, projectScreenshots, projectionApplies, storeScreenshots } from '../src/screenshot-delivery.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

function host({ refs } = {}) {
  const saved = []
  return {
    saved,
    ctx: {
      get: name => (name === 'attachments'
        ? { saveImages: async inputs => { saved.push(...inputs); return inputs.map((input, index) => refs?.[index] ?? { attachmentId: `sha-${index}`, mediaType: input.mediaType, bytes: input.data.length, width: 3, height: 4 }) } }
        : undefined),
    },
  }
}

test('the attachment service is read by name, so no host package is imported', () => {
  assert.equal(attachmentStore(host().ctx).saveImages instanceof Function, true)
  assert.equal(attachmentStore({ get: () => undefined }), undefined)
  assert.equal(attachmentStore({}), undefined)
})

test('a screenshot is stored once and returned as a durable reference', async () => {
  const { ctx, saved } = host()
  const stored = await storeScreenshots(ctx, [{ mimeType: 'image/png', data: PNG }])
  assert.equal(saved.length, 1)
  assert.equal(saved[0].mediaType, 'image/png')
  assert.equal(Buffer.compare(Buffer.from(saved[0].data), PNG), 0)
  assert.deepEqual(stored, [{ attachment: { attachmentId: 'sha-0', mediaType: 'image/png', bytes: 8, width: 3, height: 4 }, mediaType: 'image/png', bytes: 8, width: 3, height: 4 }])
})

test('an observation without images needs no attachment service', async () => {
  assert.deepEqual(await storeScreenshots({ get: () => undefined }, []), [])
  assert.deepEqual(await storeScreenshots({ get: () => undefined }, undefined), [])
})

test('a screenshot in a composition without an image store fails closed', async () => {
  await assert.rejects(storeScreenshots({ get: () => undefined }, [{ mimeType: 'image/png', data: PNG }]), /requires a durable image attachment service/)
  const { ctx } = host()
  await assert.rejects(storeScreenshots(ctx, [{ mimeType: 'image/svg+xml', data: PNG }]), /unsupported screenshot type/)
  await assert.rejects(storeScreenshots(ctx, [{ mimeType: 'image/png' }]), /screenshot bytes are missing/)
})

test('the projection keeps the rendered text and adds one image block per screenshot', () => {
  const stored = [
    { attachment: { attachmentId: 'a' }, mediaType: 'image/png', bytes: 8, width: 3, height: 4 },
    { attachment: { attachmentId: 'b' }, mediaType: 'image/png', bytes: 9, width: 5, height: 6 },
  ]
  assert.deepEqual(projectScreenshots('window text', stored), [
    { type: 'text', text: 'window text' },
    { type: 'image', attachment: { attachmentId: 'a' } },
    { type: 'image', attachment: { attachmentId: 'b' } },
  ])
  assert.equal(projectScreenshots('window text', []), undefined, 'no screenshot must leave the renderer output in place')
})

test('the projection is skipped once the value changed under it', () => {
  const recorded = { window: { windowId: '1' } }
  assert.equal(projectionApplies(recorded, { window: { windowId: '1' } }), true)
  assert.equal(projectionApplies(recorded, { window: { windowId: '2' } }), false)
  assert.equal(projectionApplies(undefined, { window: { windowId: '1' } }), false)
})