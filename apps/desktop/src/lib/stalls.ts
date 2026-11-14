import { log, asking, isNative } from './platform/src/api'

const STALL = 1000

const MOST = 3

interface Script {
  invoker: string
  sourceFunctionName: string
  sourceURL: string
  sourceCharPosition: number
  took: number
}

interface Frame {
  startTime: number
  took: number
  scripts: Script[]
}

export function watchStalls(): void {
  if (!isNative || typeof PerformanceObserver === 'undefined') return
  if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) return

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const frame = frameOf(entry)
      if (frame && frame.took >= STALL) log('warn', described(frame, waiting()))
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
}

export function described(frame: Frame, waitingOn: string[]): string {
  const ran = [...frame.scripts]
    .sort((a, b) => b.took - a.took)
    .slice(0, MOST)
    .map(
      (one) =>
        `${fileOf(one.invoker)} ${one.sourceFunctionName || '-'} ${fileOf(one.sourceURL) || '-'}:${one.sourceCharPosition} ${Math.round(one.took)} ms`,
    )
  return [
    `stall: the page was blocked ${Math.round(frame.took)} ms`,
    ran.length ? `ran ${ran.join(', ')}` : 'ran nothing it could name',
    ...(waitingOn.length ? [`waiting on ${waitingOn.join(', ')}`] : []),
  ].join('; ')
}

export function fileOf(said: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(said)
    ? (said.split(/[?#]/)[0]?.split('/').pop() ?? '')
    : said
}

function waiting(): string[] {
  const now = performance.now()
  return [...asking.values()]
    .sort((a, b) => a.at - b.at)
    .slice(0, MOST)
    .map((one) => `${one.command} ${((now - one.at) / 1000).toFixed(1)} s`)
}

function frameOf(entry: PerformanceEntry): Frame | null {
  const scripts: unknown = (entry as { scripts?: unknown }).scripts
  if (!Array.isArray(scripts)) return null
  return {
    startTime: entry.startTime,
    took: entry.duration,
    scripts: scripts.filter(isScript).map((one) => ({
      invoker: one.invoker,
      sourceFunctionName: one.sourceFunctionName,
      sourceURL: one.sourceURL,
      sourceCharPosition: one.sourceCharPosition,
      took: one.duration,
    })),
  }
}

type Reported = Omit<Script, 'took'> & Record<'duration', number>

function isScript(one: unknown): one is Reported {
  if (typeof one !== 'object' || one === null) return false
  const held = one as Record<string, unknown>
  return (
    typeof held.invoker === 'string' &&
    typeof held.sourceFunctionName === 'string' &&
    typeof held.sourceURL === 'string' &&
    typeof held.sourceCharPosition === 'number' &&
    typeof held.duration === 'number'
  )
}
