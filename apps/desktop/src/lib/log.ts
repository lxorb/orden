import { invoke, isNative } from './tauri'

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

export function collectErrors() {
  let resizeLoopSaid = false
  window.addEventListener('error', (event) => {
    const said = describe(event.error ?? event.message)
    if (said.startsWith(RESIZE_LOOP)) {
      if (resizeLoopSaid) return
      resizeLoopSaid = true
    }
    log('error', said)
  })
  window.addEventListener('unhandledrejection', (event) => log('error', describe(event.reason)))

  log('info', 'page loaded')
}
