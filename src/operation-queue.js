/**
 * Serialize Cua Driver calls and contain abandoned ones.
 *
 * The driver is a single private worker, so one runtime issues at most one call
 * at a time. A timeout or abort only stops the *caller* from waiting: the worker
 * keeps running the call it already accepted. Releasing the queue at that moment
 * would let the next call overlap an unsettled one, so an abandoned call moves
 * the runtime into quarantine until the worker actually reports it settled.
 *
 * This mirrors the DESIGN gate for future input actions: a refused, cancelled,
 * or ambiguous operation must not be silently replayed, and no post-action
 * revalidation may run against state that a still-running call could change.
 *
 * Nothing here imports `@trycua/cua-driver`, so the policy is testable without
 * loading the native addon.
 */

/** Per-call ceiling for one driver operation. */
export const ACTION_TIMEOUT_MS = 15_000
/** Ceiling for draining abandoned calls and shutting the worker down. */
export const SHUTDOWN_TIMEOUT_MS = 5_000

/** The abort reason, or a generic error when the signal carries none. */
export function abortError(signal) {
  return signal.reason instanceof Error ? signal.reason : new Error('operation aborted')
}

/**
 * Bound one promise by a timeout and an optional abort signal.
 *
 * This stops the caller from waiting; it neither cancels nor observes settlement
 * of `promise`. Callers that must not overlap a still-running call combine this
 * with {@link OperationQueue}'s quarantine.
 *
 * @param promise - The operation to bound.
 * @param timeoutMs - Timeout in milliseconds.
 * @param label - Prefix for the timeout error message.
 * @param signal - Optional abort signal.
 * @returns The operation result, or a timeout/abort rejection.
 */
export function withTimeout(promise, timeoutMs, label, signal) {
  let timer
  let onAbort
  const guards = [new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
    timer.unref?.()
    if (signal) {
      onAbort = () => reject(abortError(signal))
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })]
  return Promise.race([promise, ...guards]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  })
}

/** One runtime generation: calls run in order, or the queue refuses them. */
export class OperationQueue {
  #tail = Promise.resolve()
  #abandoned = new Set()
  #closed = false
  #generation = Symbol('cua-runtime-generation')

  /** Token identifying this runtime generation; replaced when the queue closes. */
  get generation() { return this.#generation }

  /** Whether the queue refuses every call. */
  get closed() { return this.#closed }

  /** Whether an abandoned call has not yet been reported settled by the driver. */
  get quarantined() { return this.#abandoned.size > 0 }

  /**
   * Run one operation after every accepted operation, or refuse it.
   *
   * A call made while quarantined is rejected rather than queued: it would
   * otherwise run against a worker still busy with an abandoned call.
   *
   * @param operation - The driver call to perform.
   * @param options - Abort signal, timeout, and error label.
   * @returns The operation result, or a timeout/abort/quarantine rejection.
   */
  run(operation, { signal, timeoutMs = ACTION_TIMEOUT_MS, label = 'Cua Driver operation' } = {}) {
    if (this.#closed) return Promise.reject(new Error('Cua Driver runtime is closed'))
    if (this.quarantined) return Promise.reject(new Error('Cua Driver runtime is quarantined: an earlier call has not settled'))
    const run = this.#tail.then(async () => {
      signal?.throwIfAborted()
      if (this.#closed) throw new Error('Cua Driver runtime is closed')
      if (this.quarantined) throw new Error('Cua Driver runtime is quarantined: an earlier call has not settled')
      let settled = false
      const invocation = Promise.resolve().then(operation)
      const settlement = invocation.then(() => { settled = true }, () => { settled = true })
      try {
        return await withTimeout(invocation, timeoutMs, label, signal)
      } catch (error) {
        if (!settled) {
          this.#abandoned.add(settlement)
          void settlement.then(() => { this.#abandoned.delete(settlement) })
        }
        throw error
      }
    })
    this.#tail = run.catch(() => {})
    return run
  }

  /**
   * Close the queue, wait for abandoned calls within the drain budget, then dispose.
   *
   * @param dispose - Releases the driver; runs after the drain attempt.
   * @returns Settlement of the disposal, including its own timeout.
   */
  close(dispose) {
    if (this.#closed) return this.#tail
    this.#closed = true
    this.#generation = Symbol('closed-cua-runtime-generation')
    // Snapshot now: no later call can start, so the set only shrinks from here.
    const abandoned = [...this.#abandoned]
    const final = this.#tail
      .catch(() => {})
      .then(() => withTimeout(Promise.allSettled(abandoned), SHUTDOWN_TIMEOUT_MS, 'Cua Driver abandoned-call drain'))
      .catch(() => {})
      .then(() => withTimeout(dispose(), SHUTDOWN_TIMEOUT_MS, 'Cua Driver shutdown'))
    this.#tail = final.catch(() => {})
    return final
  }
}
