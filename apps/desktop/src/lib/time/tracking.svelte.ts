import { untrack } from 'svelte'
import { deviceActivity } from '../people/here'
import { sync } from '../sync.svelte'
import { invoke, isDesktop } from '../tauri'
import { readSystemInput } from '../web-tab/activity'
import { workspace } from '../workspace.svelte'
import { time } from './time.svelte'
import { type Place, type Seen, siteOf, Tracker } from './tracker'

const EVERY = 15_000

const tracker = new Tracker({
  opened: (lane, place, at) =>
    time.addSpan({
      start: at,
      end: at,
      source: lane,
      space: lane === 'space' ? place.key : null,
      site: lane === 'site' ? place.key : null,
      label: place.name,
    }).id,
  moved: (id, end) => {
    if (!time.span(id)) return false
    time.changeSpan(id, { end })
    return true
  },
})

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

async function inFront(): Promise<boolean> {
  if (document.visibilityState !== 'visible') return false
  if (!isDesktop) return document.hasFocus()
  const system = readSystemInput(await invoke<unknown>('input_idle').catch(() => null))
  return system?.front ?? true
}

async function look(): Promise<Seen> {
  const front = await inFront()
  return {
    at: Date.now(),
    active: front && deviceActivity().active,
    space: spaceInFront(),
    site: siteInFront(),
  }
}

let looking = false

async function tick(): Promise<void> {
  if (looking || !time.ready) return
  looking = true
  try {
    tracker.seen(await look(), time.tracking)
  } finally {
    looking = false
  }
}

$effect.root(() => {
  $effect(() => {
    const looked = [workspace.activeSpace?.id, workspace.active?.address, time.tracking]
    if (looked.length) untrack(() => void tick())
  })
})

deviceActivity().changed(() => void tick())
document.addEventListener('visibilitychange', () => void tick())
window.addEventListener('pagehide', () => tracker.flush())
setInterval(() => void tick(), EVERY)
