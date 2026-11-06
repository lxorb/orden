import { invoke, isNative } from './tauri'

interface Step {
  step: string
  at: number
}

const STEPS: Step[] = []

const MOST = 200

const SETTLE = 3000

let sent = false

let facts: () => string = () => ''

export function factsOfLaunch(said: () => string): void {
  facts = said
}

export function mark(step: string): void {
  if (STEPS.length >= MOST) return
  STEPS.push({ step, at: performance.mark(`nib: ${step}`).startTime })
}

export function markPainted(step: string): void {
  requestAnimationFrame(() => requestAnimationFrame(() => mark(step)))
}

export function watchFirstInput(): void {
  const kinds = ['keydown', 'pointerdown'] as const
  const heard = () => {
    mark('interactive: first input answered')
    for (const kind of kinds) removeEventListener(kind, heard, true)
  }

  for (const kind of kinds) addEventListener(kind, heard, { capture: true, once: false })
}

export function sendTrace(): void {
  if (sent || !isNative) return
  sent = true

  setTimeout(() => {
    void invoke('trace_startup', {
      origin: performance.timeOrigin,
      steps: [...navigationSteps(), ...STEPS],
      facts: facts(),
    }).catch(() => undefined)
  }, SETTLE)
}

function navigationSteps(): Step[] {
  const entry = performance.getEntriesByType('navigation').at(0) as
    PerformanceNavigationTiming | undefined
  if (!entry) return []

  return [
    { step: 'page requested', at: entry.fetchStart },
    { step: 'page arrived', at: entry.responseEnd },
    { step: 'page parsed', at: entry.domContentLoadedEventEnd },
    { step: 'page and assets loaded', at: entry.loadEventEnd },
  ].filter((one) => one.at > 0)
}
