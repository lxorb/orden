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
