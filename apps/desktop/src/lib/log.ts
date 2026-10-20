import { invoke, isNative } from './tauri'

export type Level = 'info' | 'warn' | 'error'

/** The last lines this page logged, for a page with no log file: what a report sent
 *  with Send feedback carries from the web app (#548). A ring, so it never grows. */
const KEPT = 200
const recent: string[] = []

export function recentLog(): readonly string[] {
  return recent
}

/** Writes one line to the app's log file. Never throws: a failure to log must
 *  not become a second failure. */
export function log(level: Level, message: string) {
  const at = new Date().toISOString()
  recent.push(`${at} ${level} ${message}`)
  if (recent.length > KEPT) recent.splice(0, recent.length - KEPT)
  if (!isNative) return
  void invoke('write_log', { level, message, at }).catch(() => undefined)
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

/** What the engine says when a resize observer changed the layout it was observing,
 *  which it then delivers on the next frame: harmless, and in a burst it was most of a
 *  log somebody sent. Said once a run, so it is still seen. */
const RESIZE_LOOP = 'ResizeObserver loop'

/** Catches what would otherwise vanish into a console nobody is watching: into the log
 *  file in the app, and into the lines a feedback report carries in a browser. */
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

  // The page, not the process: the crate says when nib itself started, with its process
  // number, so a page loaded again is told apart from a launch. See stall.rs.
  log('info', 'page loaded')
}
