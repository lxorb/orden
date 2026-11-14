import {
  dayOf,
  sizeOf,
  startupOfMs,
  usageEventOf,
  type UsageDay,
  type UsageEvent,
} from '@orden/sync-core'
import { account } from '../accounts/src/api'
import { request } from '../accounts/src/api'
import { systemLocale } from '../region'
import { log } from '../log'
import { keepJson, stored } from '../stored'
import { isMobile, isNative } from '../tauri'
import { updates } from '../updates.svelte'
import { type Entry, workspace } from '../workspace.svelte'
import { USAGE_PINGED, USAGE_QUEUE, usageChoice } from './choice.svelte'
import { flush, pruned } from './queue'
import { commonOf } from './system'
import { saveTallies, started, spent, takeTallies, type Tally } from './tally'

const A_MINUTE = 60 * 1000
const AN_HOUR = 60 * A_MINUTE
const FIRST_SEND = 30 * 1000

function eventsOf(value: unknown): UsageEvent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((one) => {
    const event = usageEventOf(one)
    return typeof event === 'string' ? [] : [event]
  })
}

export function queuedEvents(): UsageEvent[] {
  return eventsOf(stored(USAGE_QUEUE))
}

function metered(): boolean {
  const connection = (navigator as { connection?: { saveData?: boolean; type?: string } })
    .connection
  return !navigator.onLine || connection?.saveData === true || connection?.type === 'cellular'
}

function keepQueue(events: UsageEvent[]): void {
  keepJson(USAGE_QUEUE, pruned(events, dayOf(Date.now()), usageChoice.helping))
}

function common() {
  const native = isNative
    ? ((window as { __TAURI_OS_PLUGIN_INTERNALS__?: Record<string, string> })
        .__TAURI_OS_PLUGIN_INTERNALS__ ?? {})
    : null
  return commonOf({
    version: __APP_VERSION__,
    channel: updates.channel,
    native,
    mobile: isMobile,
    agent: navigator.userAgent,
    language: systemLocale(),
    width: window.screen.width,
    signedIn: account.signedIn,
  })
}

function notesIn(entry: Entry | null): number {
  if (!entry) return 0
  if (!entry.is_dir) return 1
  return entry.children.reduce((sum, one) => sum + notesIn(one), 0)
}

function dayEvent(day: string, tally: Tally): UsageDay {
  return {
    v: 1,
    kind: 'usage',
    day,
    ...common(),
    install: usageChoice.install(),
    commands: tally.commands,
    features: tally.features,
    tabs: tally.tabs,
    settings: tally.settings,
    onboarding: tally.onboarding,
    startup: tally.startup,
    sizes: {
      notes: sizeOf(notesIn(workspace.tree)),
      spaces: sizeOf(workspace.spaces.length),
      tabs: sizeOf(workspace.tabs.length),
    },
  }
}

function checked(event: UsageEvent): UsageEvent[] {
  const said = usageEventOf(event)
  if (typeof said === 'string') {
    log('warn', `usage: ${said}`)
    return []
  }
  return [said]
}

export function roll(at = Date.now()): void {
  const today = dayOf(at)
  const added: UsageEvent[] = []

  if (stored(USAGE_PINGED) !== today) {
    added.push(...checked({ v: 1, kind: 'daily', day: today, ...common() }))
    keepJson(USAGE_PINGED, today)
  }
  if (usageChoice.helping) {
    for (const [day, tally] of Object.entries(takeTallies(today))) {
      added.push(...checked(dayEvent(day, tally)))
    }
  }
  if (added.length) keepQueue([...queuedEvents(), ...added])
}

let going = false

export async function sendQueued(): Promise<void> {
  if (going) return
  going = true
  try {
    keepQueue(queuedEvents())
    await flush({
      queue: queuedEvents,
      keepQueue,
      post: (events) => request('/v1/usage', { body: { events } }),
    })
  } catch (error) {
    log('warn', `usage: ${String(error)}`)
  } finally {
    going = false
  }
}

function tick(): void {
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    const kind = workspace.active?.kind
    if (kind) spent('tabs', kind)
    if (workspace.panel) spent('features', `panel-${workspace.panel}`)
  }
  roll()
}

function idle(work: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(work, { timeout: A_MINUTE })
  else setTimeout(work, 0)
}

export function watchUsage(sending: boolean): () => void {
  if (usageChoice.helping) started(startupOfMs(performance.now()))
  roll()

  const minutes = setInterval(() => idle(tick), A_MINUTE)
  const hidden = () => {
    if (document.visibilityState === 'hidden') saveTallies()
  }
  document.addEventListener('visibilitychange', hidden)
  window.addEventListener('pagehide', saveTallies)

  const send = () =>
    idle(() => {
      roll()
      if (sending && !metered()) void sendQueued()
    })
  const first = setTimeout(send, FIRST_SEND)
  const hourly = setInterval(send, AN_HOUR)
  window.addEventListener('online', send)
  const chose = () => {
    keepQueue(queuedEvents())
    send()
  }
  usageChoice.changes.add(chose)

  return () => {
    saveTallies()
    clearInterval(minutes)
    clearInterval(hourly)
    clearTimeout(first)
    document.removeEventListener('visibilitychange', hidden)
    window.removeEventListener('pagehide', saveTallies)
    window.removeEventListener('online', send)
    usageChoice.changes.delete(chose)
  }
}
