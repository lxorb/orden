import { invoke, isDesktop, isNative } from './tauri'

export type Level = 'info' | 'warn' | 'error'

const KEPT = 200
const recent: string[] = []

export function recentLog(): readonly string[] {
  return recent
}

export function log(level: Level, message: string) {
  const at = new Date().toISOString()
  recent.push(`${at} ${level} ${message}`)
  if (recent.length > KEPT) recent.splice(0, recent.length - KEPT)
  if (!isNative) return
  void invoke('write_log', { level, message, at }).catch(() => undefined)
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim()
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const RESIZE_LOOP = 'ResizeObserver loop'

const NOT_BROKEN = /^(?:AbortError|TypeError: (?:Failed to fetch|NetworkError|Load failed))/

function report(error: unknown) {
  if (!isDesktop) return
  const message = error instanceof Error ? `${error.name}: ${error.message}` : describe(error)
  if (message.startsWith(RESIZE_LOOP) || NOT_BROKEN.test(message)) return
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  void invoke('crash_report_js', { message, stack }).catch(() => undefined)
}

export function collectErrors() {
  let resizeLoopSaid = false
  window.addEventListener('error', (event) => {
    const said = describe(event.error ?? event.message)
    if (said.startsWith(RESIZE_LOOP)) {
      if (resizeLoopSaid) return
      resizeLoopSaid = true
    }
    log('error', said)
    report(event.error ?? event.message)
  })
  window.addEventListener('unhandledrejection', (event) => {
    log('error', describe(event.reason))
    report(event.reason)
  })

  log('info', 'page loaded')
}
