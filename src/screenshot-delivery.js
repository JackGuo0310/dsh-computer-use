/**
 * Store observed window screenshots as durable attachments.
 *
 * A screenshot may only reach the model through a durable attachment reference:
 * the canonical tool value is lossless JSON, so raw bytes cannot live there, and
 * base64 in the result text would be stored in the session log and counted
 * against the context for no benefit. The Host owns this service as
 * `ctx.attachments`, reached by name so the plugin never imports a host package.
 *
 * @module
 */

import { isDeepStrictEqual } from 'node:util'

const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/**
 * Whether the Host has a durable image store mounted.
 *
 * @param ctx - Host context to read the optional service from.
 * @returns The attachment store, or `undefined` when none is mounted.
 */
export function attachmentStore(ctx) {
  return ctx.get?.('attachments')
}

/**
 * Persist the images of one observation and describe them for the tool result.
 *
 * Image bytes never enter the canonical value; only the durable reference does.
 * The service validates the encoded raster and normalizes it, so a caller
 * cannot present bytes that are not the image it claims to be.
 *
 * @param ctx - Host context providing the optional attachment service.
 * @param images - Bounded images from a snapshot projection.
 * @returns One `{ attachment, mediaType, bytes, width, height }` record per image.
 */
export async function storeScreenshots(ctx, images) {
  if (!Array.isArray(images) || images.length === 0) return []
  const attachments = attachmentStore(ctx)
  if (attachments === undefined) throw new Error('screenshot output requires a durable image attachment service in this composition')
  for (const image of images) {
    if (!MEDIA_TYPES.has(image?.mimeType)) throw new Error(`unsupported screenshot type: ${image?.mimeType}`)
    if (!Buffer.isBuffer(image.data) && !(image.data instanceof Uint8Array)) throw new Error('screenshot bytes are missing')
  }
  const refs = await attachments.saveImages(images.map(image => ({ data: image.data, mediaType: image.mimeType })))
  if (!Array.isArray(refs) || refs.length !== images.length) throw new Error('the image attachment service returned an unexpected number of references')
  return refs.map(ref => Object.freeze({
    attachment: ref,
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
  }))
}

/**
 * Build the content projection that shows stored screenshots to the model.
 *
 * The registry calls this once per successful call and uses the result in place
 * of the text renderer, so the model receives the same text plus one image block
 * per stored screenshot. Returning `undefined` preserves the renderer output,
 * which is what happens for an error result or when a policy already replaced
 * the content.
 *
 * @param fallbackText - Text the renderer produced for the same value.
 * @param stored - Stored screenshot records for the same value.
 * @returns Replacement content blocks, or `undefined` to keep the renderer output.
 */
export function projectScreenshots(fallbackText, stored) {
  if (!Array.isArray(stored) || stored.length === 0) return undefined
  return [
    { type: 'text', text: fallbackText },
    ...stored.map(record => ({ type: 'image', attachment: record.attachment })),
  ]
}

/**
 * Whether the projection still applies to the value about to be published.
 *
 * The registry may replace the canonical value between execution and projection.
 * Projecting an image onto a value that changed would attach a screenshot to
 * output it does not depict, so a mismatch preserves the renderer output instead.
 *
 * @param recorded - The canonical value captured during execution.
 * @param value - Canonical value the registry is about to publish.
 * @returns Whether the projection still applies.
 */
export function projectionApplies(recorded, value) {
  return recorded !== undefined && isDeepStrictEqual(recorded, value)
}