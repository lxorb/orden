import { base64 } from '@orden/pass/bytes'
import { Channel } from '../../crate/src/api'
import { invoke } from '../../platform/src/api'

interface Head {
  status: number
  headers: [string, string][]
}
const NO_BODY = new Set([101, 204, 205, 304])
let next = Math.floor(Math.random() * 2 ** 31)
const bytesOf = (text: string) => Uint8Array.from(atob(text), (one) => one.charCodeAt(0))
const stopped = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException('The request was stopped.', 'AbortError')
export async function nativeFetch(url: string, init: RequestInit): Promise<Response> {
  const { signal, ...rest } = init
  if (signal?.aborted) throw stopped(signal)
  const request = new Request(url, rest)
  const sent = request.body ? new Uint8Array(await request.arrayBuffer()) : null
  const id = (next = (next + 1) >>> 0)
  let finished = false
  let control: ReadableStreamDefaultController<Uint8Array> | null = null
  const body = new ReadableStream<Uint8Array>({
    start: (held) => {
      control = held
    },
    cancel: () => stop(),
  })
  const done = (error?: unknown) => {
    if (finished) return
    finished = true
    signal?.removeEventListener('abort', aborted)
    if (error === undefined) control?.close()
    else control?.error(error)
  }
  const stop = () => {
    if (finished) return
    done(new DOMException('The request was stopped.', 'AbortError'))
    void invoke('ai_fetch_stop', { id }).catch(() => undefined)
  }
  let refuse: (reason: unknown) => void = () => undefined
  const refused = new Promise<never>((_, no) => (refuse = no))
  refused.catch(() => undefined)
  function aborted() {
    const reason = signal ? stopped(signal) : null
    if (!finished) {
      void invoke('ai_fetch_stop', { id }).catch(() => undefined)
      done(reason)
    }
    refuse(reason)
  }
  signal?.addEventListener('abort', aborted, { once: true })
  const output = new Channel<unknown>()
  output.onmessage = (value) => {
    if (finished || typeof value !== 'object' || value === null) return
    const said = value as { data?: unknown; end?: unknown; error?: unknown }
    if (typeof said.data === 'string') control?.enqueue(bytesOf(said.data))
    else if (said.end === true) done()
    else if (typeof said.error === 'string') done(new TypeError(said.error))
  }
  const asked = invoke<Head>('ai_fetch', {
    id,
    url: request.url,
    method: request.method,
    headers: [...request.headers],
    body: sent ? base64(sent) : null,
    output,
  }).catch((error: unknown) => {
    done(error)
    throw new TypeError(error instanceof Error ? error.message : String(error), { cause: error })
  })
  const head = await Promise.race([asked, refused])
  try {
    return new Response(NO_BODY.has(head.status) ? null : body, { status: head.status, headers: head.headers })
  } catch (error) {
    stop()
    throw new TypeError(error instanceof Error ? error.message : String(error), { cause: error })
  }
}
