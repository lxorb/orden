import { untrack } from 'svelte'
import { sync } from '../sync.svelte'
import { invoke, isDesktop } from '../tauri'
import { workspace } from '../workspace.svelte'
import { timeOn } from '../settings.svelte'
import { MinuteFold, SAMPLE_EVERY } from './minutes'
import { type Sensed, sensedOf } from './sensed'
import { time } from './time.svelte'
import { type Place, siteOf, Tracker } from './tracker'

const AWAY = 5 * 60_000

const tracker = new Tracker({
  opened: (lane, place, start, end) =>
    time.addSpan({ start, end, source: lane, place: place.key, label: place.name }).id,
  moved: (id, end) => {
    if (!time.span(id)) return false
    time.changeSpan(id, { end })
    return true
  },
})

const fold = new MinuteFold()

let lastInput = Date.now()

let leading = false

const locks = 'locks' in navigator ? navigator.locks : null

if (locks) {
  void locks.request('nib-time-sense', () => {
    leading = true
    return new Promise<never>(() => undefined)
  })
} else {
  leading = true
}

function spaceInFront(): Place | null {
  const space = workspace.activeSpace
  if (!space) return null
  return { key: sync.remoteIdFor(space.root) ?? `name:${space.name}`, name: space.name }
}

function tabInFront(): Place | null {
  const tab = workspace.active
  if (!tab || tab.inPrivate) return null
  return { key: tab.path ?? `${tab.kind}:${tab.name}`, name: tab.name }
}

function siteInFront(): Place | null {
  const tab = workspace.active
  if (tab?.kind !== 'web' || tab.inPrivate) return null
  const site = siteOf(tab.address)
  return site ? { key: site, name: site } : null
}

const shown = () => document.visibilityState === 'visible'

async function sense(): Promise<Sensed> {
  if (isDesktop) {
    const said = sensedOf(await invoke<unknown>('time_sense').catch(() => null))
    if (said) return said
  }
  return {
    idleMs: Date.now() - lastInput,
    front: shown() && document.hasFocus(),
    app: null,
    cpu: null,
    memory: null,
    battery: null,
    charging: null,
    lid: null,
    locked: null,
  }
}

let looking = false

async function look(): Promise<void> {
  if (looking || !time.ready) return
  if (!timeOn() || !time.recording) {
    tracker.flush()
    const last = fold.flush()
    if (last && timeOn()) time.keepMinutes([last])
    return
  }
  looking = true
  try {
    const sensed = await sense()
    const at = Date.now()
    const here = (sensed.idleMs ?? 0) < AWAY && sensed.locked !== true && sensed.lid !== false
    const front = here && (sensed.front ?? shown()) && document.hasFocus()
    tracker.seen({
      at,
      places: here
        ? {
            app: leading && sensed.app ? { key: sensed.app, name: sensed.app } : null,
            space: front ? spaceInFront() : null,
            tab: front ? tabInFront() : null,
            site: front ? siteInFront() : null,
          }
        : {},
    })
    if (!leading) return
    const closed = fold.add({ at, ...sensed })
    if (closed) time.keepMinutes([closed])
  } finally {
    looking = false
  }
}

$effect.root(() => {
  $effect(() => {
    const looked = [workspace.activeSpace?.id, workspace.active?.id, workspace.active?.address]
    if (looked.length) untrack(() => void look())
  })
})

const heard = () => {
  lastInput = Date.now()
}
for (const kind of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(kind, heard, { passive: true, capture: true })
}
document.addEventListener('visibilitychange', () => void look())
window.addEventListener('pagehide', () => {
  tracker.flush()
  const last = fold.flush()
  if (last) time.keepMinutes([last])
})
setInterval(() => void look(), SAMPLE_EVERY)
