import { invoke, isDesktop } from './tauri'

export type Level = 'info' | 'warn' | 'error'

/** Writes one line to the app's log file. Never throws: a failure to log must
 *  not become a second failure. */
function log(level: Level, message: string) {
  if (!isDesktop) return
  void invoke('write_log', { level, message, at: new Date().toISOString() }).catch(() => undefined)
}

/** Turns whatever was thrown into something worth reading back later. */
function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}\n${error.stack ?? ''}`.trim()
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Catches what would otherwise vanish into a console nobody is watching. */
export function collectErrors() {
  if (!isDesktop) return

  window.addEventListener('error', (event) => log('error', describe(event.error ?? event.message)))
  window.addEventListener('unhandledrejection', (event) => log('error', describe(event.reason)))

  log('info', 'started')
}
