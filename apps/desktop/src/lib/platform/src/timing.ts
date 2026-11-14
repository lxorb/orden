export function waited(ms = 0): Promise<void> {
  return new Promise((go) => setTimeout(go, ms))
}

export interface Later {
  (): void
  cancel(): void
  flush(): void
}

export function afterQuiet(
  run: () => void,
  ms: number | (() => number),
  atMost = Number.POSITIVE_INFINITY,
): Later {
  let timer: ReturnType<typeof setTimeout> | undefined
  let since: number | undefined

  const waiting = () => {
    timer = undefined
    since = undefined
    run()
  }

  const later = () => {
    clearTimeout(timer)
    const now = Date.now()
    since ??= now

    const wait = typeof ms === 'number' ? ms : ms()
    timer = setTimeout(waiting, Math.max(0, Math.min(wait, since + atMost - now)))
  }

  later.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    since = undefined
  }

  later.flush = () => {
    if (timer === undefined) return

    clearTimeout(timer)
    timer = undefined
    since = undefined
    run()
  }

  return later
}

export function onceAFrame(run: () => void): Later {
  let frame: number | undefined

  const arrive = () => {
    frame = undefined
    run()
  }

  const ask = (): number =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(arrive)
      : (setTimeout(arrive, 0) as unknown as number)

  const drop = (held: number) => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(held)
    else clearTimeout(held as unknown as ReturnType<typeof setTimeout>)
  }

  const soon = () => {
    frame ??= ask()
  }

  soon.cancel = () => {
    if (frame !== undefined) drop(frame)
    frame = undefined
  }

  soon.flush = () => {
    if (frame === undefined) return

    drop(frame)
    frame = undefined
    run()
  }

  return soon
}

export const ANSWERS_WITHIN = 120_000

export const BYTES_WITHIN = 30 * 60_000

export const LATE = 'the account did not answer in time'

const NO_BODY: ReadonlySet<number> = new Set([101, 103, 204, 205, 304])

export async function fetchInTime(
  input: string | Request,
  init: RequestInit = {},
  within: number = ANSWERS_WITHIN,
): Promise<Response> {
  const giving = new AbortController()
  const timer = setTimeout(() => giving.abort(), within)
  const asked = init.signal ?? (typeof input === 'string' ? null : input.signal)
  const stopped = () => giving.abort(asked?.reason)
  if (asked?.aborted) stopped()
  else asked?.addEventListener('abort', stopped, { once: true })
  try {
    const response = await fetch(input, { ...init, signal: giving.signal })
    const bytes = await response.arrayBuffer()
    return new Response(NO_BODY.has(response.status) ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    if (giving.signal.aborted && !asked?.aborted) throw new TypeError(LATE, { cause: error })
    throw error
  } finally {
    clearTimeout(timer)
    asked?.removeEventListener('abort', stopped)
  }
}
