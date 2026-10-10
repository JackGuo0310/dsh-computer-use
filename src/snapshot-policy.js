/**
 * Bounded, driver-independent projection of one Cua window snapshot.
 *
 * This module deliberately imports nothing from `@trycua/cua-driver`: the
 * projection and its refusals are the part worth exercising in tests, and
 * loading the native addon into a test process is neither necessary nor safe.
 * `src/cua-adapter.js` owns the SDK calls and delegates the bounding here.
 */

/** Element ceiling for one snapshot; also passed to the driver as `maxElements`. */
export const MAX_ELEMENTS = 200
/** Accessibility-tree text ceiling. */
export const MAX_TEXT = 4096
/** Screenshot byte ceiling per snapshot image. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const SUPPORTED_IMAGE = /^image\/(png|jpeg|webp)$/
const ACTION_NAMES = ['click', 'press', 'select', 'toggle']

function boundedText(value, limit) {
  return typeof value === 'string' ? value.slice(0, limit) : ''
}

/** Read a driver count that arrives as a bigint, a number, or not at all. */
function count(value) {
  if (typeof value === 'bigint') return Number(value)
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Validate and bound one raw `getWindowState` result for a selected target.
 *
 * Refuses a snapshot that describes another window, that the driver marks
 * degraded, that silently returned fewer elements than the window contains, or
 * whose frame it marks stale for a requested screenshot. Explicit truncation
 * stays reportable through `truncated` rather than failing the observation, and
 * the driver's own completeness fields are passed through instead of being
 * reinterpreted: on Windows 0.28.0 the driver reports `elementsComplete: false`
 * for a Notepad window whose total, returned, and reported element counts all
 * agree, so that flag alone is not evidence that elements were dropped.
 *
 * @param state - Raw `WindowStateOutput` from the driver.
 * @param target - Frozen window identity the snapshot must describe.
 * @param options - `includeScreenshot` mirrors the driver request.
 * @returns Frozen bounded snapshot for the tool layer.
 */
export function projectSnapshot(state, target, { includeScreenshot = false } = {}) {
  if (state.pid !== target.pid || state.windowId !== target.windowId || state.degraded) throw new Error('Cua returned a degraded window snapshot for an unexpected window')
  const total = count(state.totalElementCount)
  const returned = count(state.returnedElementCount)
  // Explicit truncation is reported separately as `truncated`; only a silent
  // shortfall must fail, or a partial element set would read as complete.
  if (total !== undefined && returned !== undefined && returned < total && state.truncated !== true) throw new Error('Cua returned fewer elements than the window contains, without reporting truncation')
  if (includeScreenshot && state.screenshotFrameValid === false) throw new Error('Cua reported a stale screenshot frame for the window snapshot')
  const elements = Array.isArray(state.elements) ? state.elements : []
  if (elements.length > MAX_ELEMENTS) throw new Error('Cua snapshot exceeds the element limit')
  const safeElements = elements.map(element => {
    const index = Number(element.elementIndex)
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Cua returned an invalid element index')
    return Object.freeze({
      index,
      role: boundedText(element.role, 80),
      label: boundedText(element.label ?? '', 256),
      value: boundedText(element.value ?? '', 256),
      enabled: element.enabled !== false,
      selected: element.selected === true,
      token: typeof element.elementToken === 'string' ? element.elementToken : undefined,
      actions: Array.isArray(element.actions) ? element.actions.filter(action => typeof action === 'string' && ACTION_NAMES.includes(action.toLowerCase())) : [],
      frame: element.frame ? { ...element.frame } : undefined,
    })
  })
  const images = (state.images ?? []).map(image => {
    const data = Buffer.from(image.dataBase64, 'base64')
    if (data.length > MAX_IMAGE_BYTES) throw new Error('Cua screenshot exceeds the image limit')
    return Object.freeze({ mimeType: image.mimeType, data })
  })
  if (includeScreenshot && (!images.length || images.some(image => !SUPPORTED_IMAGE.test(image.mimeType)))) throw new Error('Cua did not return a supported target-window screenshot')
  // Tool output must stay lossless JSON, so absent optional fields are omitted
  // rather than carried as `undefined`, which the registry refuses.
  return Object.freeze({
    snapshotId: boundedText(state.snapshotId ?? '', 128),
    treeMarkdown: boundedText(state.treeMarkdown ?? '', MAX_TEXT),
    elements: safeElements,
    truncated: state.truncated === true,
    elementsComplete: state.elementsComplete === true,
    ...state.truncated === true ? { truncatedReason: boundedText(state.truncationReason ?? '', 200) } : {},
    ...total === undefined ? {} : { totalElementCount: total },
    images,
  })
}
