import { untrack } from 'svelte'
import { sync } from '../../sync-store/src/api'
import { invoke, isDesktop } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { timeOn } from '../../gates/src/api'
import { SAMPLE_EVERY } from './minutes'
import { Sampler } from './sampler'
import { type Sensed, sensedOf, withIdle } from './sensed'
import { time } from './time.svelte'
import { type Place, siteOf, tabPlace, Tracker } from './tracker'

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
let lastInput = Date.now()
let leading = false
const locks = 'locks' in navigator ? navigator.locks : null
if (locks) {
  void locks.request('orden-time-sense', () => {
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
function siteInFront(): Place | null {
  const tab = workspace.active
  if (tab?.kind !== 'web' || tab.inPrivate) return null
  const site = siteOf(tab.address)
  return site ? { key: site, name: site } : null
}
const shown = () => document.visibilityState === 'visible'
const near = (): Sensed => ({
  idleMs: Date.now() - lastInput,
  front: shown() && document.hasFocus(),
  app: null,
  lid: null,
  locked: null,
})
const sampler = new Sampler({
  asked: async () => {
    if (!isDesktop) return null
    const said = sensedOf(await invoke<unknown>('time_sense'))
    return said && withIdle(said, Date.now() - lastInput)
  },
  near,
  seen: (sensed, at) => {
    const here = (sensed.idleMs ?? 0) < AWAY && sensed.locked !== true && sensed.lid !== false
    const front = here && (sensed.front ?? shown()) && document.hasFocus()
    tracker.seen({
      at,
      places: here
        ? {
            app: leading && sensed.app ? { key: sensed.app, name: sensed.app } : null,
            space: front ? spaceInFront() : null,
            tab: front ? tabPlace(workspace.active) : null,
            site: front ? siteInFront() : null,
          }
        : {},
    })
  },
  leading: () => leading,
  kept: (minutes) => time.keepMinutes(minutes),
})
async function look(): Promise<void> {
  if (!time.ready) return
  if (!timeOn() || !time.recording) {
    tracker.flush()
    sampler.flush(timeOn())
    return
  }
  await sampler.look()
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
  sampler.flush()
})
setInterval(() => void look(), SAMPLE_EVERY)
