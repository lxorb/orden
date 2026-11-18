export const waited = (ms = 0): Promise<void> => new Promise((go) => setTimeout(go, ms))

export interface Later {
  (): void
  cancel(): void
  flush(): void
}

function later(
  ask: (fire: () => void) => void,
  stop: () => void,
  waiting: () => boolean,
  run: () => void,
): Later {
  const fire = () => {
    stop()
    run()
  }
  return Object.assign(() => ask(fire), {
    cancel: stop,
    flush: () => {
      if (waiting()) fire()
    },
  })
}

export function afterQuiet(
  run: () => void,
  ms: number | (() => number),
  atMost = Number.POSITIVE_INFINITY,
): Later {
  let timer: ReturnType<typeof setTimeout> | undefined
  let since: number | undefined
  const stop = () => {
    clearTimeout(timer)
    timer = since = undefined
  }
  const ask = (fire: () => void) => {
    clearTimeout(timer)
    const now = Date.now()
    since ??= now
    const wait = typeof ms === 'number' ? ms : ms()
    timer = setTimeout(fire, Math.max(0, Math.min(wait, since + atMost - now)))
  }
  return later(ask, stop, () => timer !== undefined, run)
}

export function onceAFrame(run: () => void): Later {
  let frame: number | undefined
  const stop = () => {
    if (frame === undefined) return
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    else clearTimeout(frame as unknown as ReturnType<typeof setTimeout>)
    frame = undefined
  }
  const ask = (fire: () => void) => {
    frame ??=
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(fire)
        : (setTimeout(fire, 0) as unknown as number)
  }
  return later(ask, stop, () => frame !== undefined, run)
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
