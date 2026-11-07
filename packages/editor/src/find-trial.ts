export const TRIAL_MS = 300

export function scanPattern(source: string, flags: string, text: string, lines: boolean): number {
  const pattern = new RegExp(source, flags)
  const parts = lines ? text.split('\n') : [text]
  let found = 0
  for (const part of parts) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(part); match; match = pattern.exec(part)) {
      found++
      if (match[0] === '') pattern.lastIndex++
      if (pattern.lastIndex > part.length) break
    }
  }
  return found
}

export const TRIAL_SCRIPT = `var scan = ${String(scanPattern)}
self.onmessage = function (event) {
  var asked = event.data
  self.postMessage({ id: asked.id, begun: true })
  try {
    scan(asked.source, asked.flags, asked.text, asked.lines)
  } catch (error) {}
  self.postMessage({ id: asked.id, begun: false })
}`

interface Said {
  id: number
  begun: boolean
}

let worker: Worker | null = null
let script: string | null = null
let asked = 0
let queue: Promise<unknown> = Promise.resolve()

function open(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  try {
    script ??= URL.createObjectURL(new Blob([TRIAL_SCRIPT], { type: 'text/javascript' }))
    worker = new Worker(script)
  } catch {
    return null
  }
  return worker
}

function shut(one: Worker) {
  one.terminate()
  if (worker === one) worker = null
}

function once(source: string, flags: string, text: string, lines: boolean): Promise<boolean> {
  const away = open()
  if (!away) return Promise.resolve(true)

  const id = ++asked
  return new Promise<boolean>((settle) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (quick: boolean) => {
      clearTimeout(timer)
      away.onmessage = null
      away.onerror = null
      if (!quick) shut(away)
      settle(quick)
    }
    away.onmessage = (event: MessageEvent<Said>) => {
      if (event.data.id !== id) return
      if (event.data.begun) timer = setTimeout(() => done(false), TRIAL_MS)
      else done(true)
    }
    away.onerror = (event) => {
      event.preventDefault()
      clearTimeout(timer)
      away.onmessage = null
      away.onerror = null
      shut(away)
      settle(true)
    }
    away.postMessage({ id, source, flags, text, lines })
  })
}

export function quickEnough(
  source: string,
  flags: string,
  text: string,
  lines: boolean,
): Promise<boolean> {
  const turn = queue.then(() => once(source, flags, text, lines))
  queue = turn.catch(() => undefined)
  return turn
}
