import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { randomUUID } from 'node:crypto'

const MAX_RESPONSE_BYTES = 128_000
const REQUEST_TIMEOUT_MS = 5_000

export class HelperClient {
  #child
  #decoder = new StringDecoder('utf8')
  #buffer = ''
  #waiting = null
  #closed = false
  #failed = null

  constructor(child) {
    this.#child = child
    child.stdout.on('data', chunk => {
      if (this.#failed) return
      this.#buffer += this.#decoder.write(chunk)
      const newline = this.#buffer.indexOf('\n')
      if (Buffer.byteLength(newline < 0 ? this.#buffer : this.#buffer.slice(0, newline)) > MAX_RESPONSE_BYTES + 1) return this.#fail(new Error('oversized helper response'))
      if (newline < 0) return
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '')
      this.#buffer = this.#buffer.slice(newline + 1)
      if (this.#buffer) return this.#fail(new Error('unexpected helper output'))
      if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) return this.#fail(new Error('oversized helper response'))
      const waiting = this.#waiting
      if (!waiting) return this.#fail(new Error('unexpected helper output'))
      try {
        const message = JSON.parse(line)
        if (!message || message.id !== waiting.id || !(message.error === null || typeof message.error === 'string') || !Object.hasOwn(message, 'result')) throw new Error('invalid helper response')
        this.#waiting = null
        waiting.finish(message.error ? new Error(message.error) : null, message.result)
      } catch (error) { this.#fail(error) }
    })
    child.stdout.on('close', () => this.#fail(new Error('helper output closed')))
    child.stdout.on('error', error => this.#fail(error))
    child.on('error', error => this.#fail(error))
    child.on('exit', () => this.#fail(new Error('helper exited')))
  }

  static async start(command, args = [], options = {}) {
    const { signal, ...spawnOptions } = options
    signal?.throwIfAborted()
    const child = spawn(command, args, { ...spawnOptions, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    const client = new HelperClient(child)
    try {
      const hello = await client.call('hello', {}, signal)
      if (hello?.version !== 1) throw new Error('incompatible helper protocol')
      return client
    } catch (error) {
      await client.close()
      throw error
    }
  }

  async call(method, parameters, signal) {
    if (this.#closed || this.#failed) throw this.#failed ?? new Error('helper closed')
    if (this.#waiting) throw new Error('helper busy')
    signal?.throwIfAborted()
    const id = randomUUID()
    const payload = JSON.stringify({ id, method, params: parameters })
    if (Buffer.byteLength(payload) > 16_384) throw new Error('request exceeds protocol limits')
    return await new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        if (error) reject(error)
        else resolve(value)
      }
      const abort = () => this.#fail(signal.reason ?? new Error('request aborted'))
      const timer = setTimeout(() => this.#fail(new Error('helper request timed out')), REQUEST_TIMEOUT_MS)
      signal?.addEventListener('abort', abort, { once: true })
      this.#waiting = { id, finish }
      if (signal?.aborted) { abort(); return }
      try { this.#child.stdin.write(`${payload}\n`, error => { if (error) this.#fail(error) }) }
      catch (error) { this.#fail(error) }
    })
  }

  #fail(error) {
    if (this.#failed) return
    this.#failed = error
    const waiting = this.#waiting
    this.#waiting = null
    waiting?.finish(error)
    try { this.#child.kill() } catch { /* Already exited; the pending request was rejected. */ }
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    this.#fail(new Error('helper closed'))
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) return
    await new Promise(resolve => {
      const timeout = setTimeout(resolve, 2_000)
      this.#child.once('exit', () => { clearTimeout(timeout); resolve() })
    })
  }
}
