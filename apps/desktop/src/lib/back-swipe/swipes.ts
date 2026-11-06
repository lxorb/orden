import { mount, unmount } from 'svelte'
import { overlays } from '../overlays'
import { reading } from '../direction'
import { dur } from '../motion'
import { isDesktop, isMobile } from '../tauri'
import { viewport } from '../viewport.svelte'
import { pages } from '../web-tab/pages.svelte'
import { type Tab, workspace } from '../workspace.svelte'
import { swipeChoice } from './choice.svelte'
import { chainOf, taken } from './edge'
import { QUIET, SETTLE, type Side, type Source, Swipe, type Turn } from './gesture'
import { type Room, swiping } from './shown.svelte'
import { Slid } from './slid'
import SwipeArrow from './SwipeArrow.svelte'

export const SIDE = 24

export const PLAYS = 210

export const HOLD = 4_000

const KEPT: Record<Side, boolean> = { left: true, right: true }

const NEITHER: Record<Side, boolean> = { left: false, right: false }

export interface Heard {
  tab: Tab
  source: Source
  dx: number
  dy: number
  at: number
  scrolls: Record<Side, boolean>
}

interface Live {
  swipe: Swipe
  tab: Tab
  source: Source
  told: boolean
  shown: boolean
  stepped: boolean
  went: boolean
  swallowed: boolean
  first: number
  at: number
  heardAt: number
  room: Room | null
}

let live: Live | null = null
let quiet: ReturnType<typeof setTimeout> | undefined
let clearing: ReturnType<typeof setTimeout> | undefined
let settling = 0

const pad = { known: false, down: false }

export function wayOf(side: Side): 'back' | 'forward' {
  const back: Side = reading() === 'rtl' ? 'right' : 'left'
  return side === back ? 'back' : 'forward'
}

function goes(tab: Tab): Record<Side, boolean> {
  const can = (side: Side) => {
    const way = wayOf(side)
    if (tab.kind === 'web') {
      const page = pages.of(tab.id)
      return way === 'back' ? page.back : page.forward
    }
    return way === 'back' ? tab.canGoBack : tab.canGoForward
  }
  return { left: can('left'), right: can('right') }
}

function paneOf(tab: Tab): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('[data-pane]')
  return Array.from(all).find((one) => one.dataset.pane === tab.paneId) ?? null
}

function roomOf(pane: HTMLElement): Room {
  const page = pane.querySelector('.hole')
  const box = (page ?? pane).getBoundingClientRect()
  const head = page ? null : Array.from(pane.children).find((one) => one.classList.contains('head'))
  const top = head ? Math.max(box.top, head.getBoundingClientRect().bottom) : box.top
  return { x: box.left, y: top, width: box.width, height: box.bottom - top }
}

function draw(one: Live) {
  const { phase, side, progress } = one.swipe.shown
  if (!one.room) {
    const pane = paneOf(one.tab)
    if (!pane) return
    one.room = roomOf(pane)
  }
  swiping.tab = one.tab.id
  swiping.pane = one.tab.paneId
  swiping.room = one.room
  swiping.side = side
  swiping.stage = phase === 'went' ? 'went' : phase === 'stayed' ? 'stayed' : 'tracking'
  swiping.progress = progress
  swiping.travel = one.swipe.shown.travel
  swiping.turn++
}

function played() {
  clearTimeout(clearing)
  clearing = setTimeout(gone, dur(PLAYS))
}

function gone() {
  clearTimeout(clearing)
  swiping.tab = null
  swiping.pane = null
  swiping.room = null
  swiping.progress = 0
  swiping.travel = 0
  swiping.turn++
}

function decided(one: Live, phase: 'went' | 'stayed', side: Side) {
  if (one.stepped) return
  one.stepped = true
  one.went = phase === 'went'
  if (one.shown) {
    swiping.stage = phase
    swiping.turn++
    played()
  }
  if (phase !== 'went') return
  if (wayOf(side) === 'back') workspace.goBack(one.tab.id)
  else workspace.goForward(one.tab.id)
}

export function heard(step: Heard): void {
  if (!swipeChoice.on) {
    end('dropped')
    return
  }
  if (step.source === 'touchpad' && pad.known && !pad.down) return
  if (live && (live.tab.id !== step.tab.id || live.source !== step.source)) end('lifted')

  const now = performance.now()
  const told = step.source === 'touch' || pad.known
  live ??= {
    swipe: new Swipe(step.source, () => ({ width: innerWidth, height: innerHeight }), told),
    tab: step.tab,
    source: step.source,
    told,
    shown: false,
    stepped: false,
    went: false,
    swallowed: !told && now < settling,
    first: step.at,
    at: step.at,
    heardAt: now,
    room: null,
  }
  const one = live
  one.at = step.at
  one.heardAt = now
  clearTimeout(quiet)
  quiet = one.told
    ? setTimeout(() => end('dropped'), HOLD)
    : setTimeout(() => end('lifted', step.at + QUIET), QUIET)
  if (one.swallowed) return

  const turn: Turn = {
    dx: step.dx,
    dy: step.dy,
    at: step.at,
    scrolls: step.scrolls,
    goes: goes(step.tab),
  }
  const shown = one.swipe.turn(turn)

  if (shown.phase === 'tracking' || (shown.phase === 'gathering' && shown.travel > 0)) {
    clearTimeout(clearing)
    one.shown = true
    draw(one)
  } else if (shown.phase === 'gathering' && one.shown) {
    draw(one)
  } else if (shown.phase === 'content' && one.shown && !one.stepped) {
    one.stepped = true
    swiping.stage = 'stayed'
    swiping.turn++
    played()
  } else if ((shown.phase === 'went' || shown.phase === 'stayed') && !one.stepped) {
    if (one.shown) draw(one)
    decided(one, shown.phase, shown.side)
  }
}

function end(how: 'lifted' | 'dropped', at?: number): void {
  clearTimeout(quiet)
  const one = live
  live = null
  if (!one || one.swallowed) return
  if (how === 'lifted') {
    const when = at ?? one.at + (performance.now() - one.heardAt)
    const shown = one.swipe.lift(when)
    if (shown.phase === 'went' || shown.phase === 'stayed') {
      if (one.shown) draw(one)
      decided(one, shown.phase, shown.side)
    }
    if (one.went && !one.told) settling = performance.now() + SETTLE
  }
  if (one.shown && !one.stepped) decided(one, 'stayed', one.swipe.shown.side)
}

export function touchpad(fingers: number): void {
  pad.known = true
  if (fingers >= 3) {
    if (live?.source === 'touchpad') end('dropped')
    pad.down = false
    return
  }
  const down = fingers >= 2
  if (down === pad.down) return
  pad.down = down
  if (live?.source !== 'touchpad') return
  end(down ? 'dropped' : 'lifted')
}

function tabUnder(target: EventTarget | null): { tab: Tab; pane: HTMLElement; at: Element } | null {
  if (!(target instanceof Element) || overlays.depth > 0) return null
  const pane = target.closest<HTMLElement>('[data-pane]')
  if (!pane || target.closest('[data-chrome]')) return null
  const tab = workspace.showing(pane.dataset.pane ?? '')
  if (!tab || tab.kind === 'web') return null
  return { tab, pane, at: target }
}

export function fromTouchpad(event: WheelEvent, streaming: boolean): boolean {
  if (event.deltaMode !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
    return false
  }
  const notch = 'wheelDeltaX' in event ? Number(event.wheelDeltaX) : 0
  return streaming || !(notch !== 0 && notch % 120 === 0)
}

const slid = new Slid()

function scrolled(event: Event) {
  if (!(event.target instanceof Element)) return
  const pane = event.target.closest<HTMLElement>('[data-pane]')?.dataset.pane ?? null
  slid.heard(event.target, pane, event.timeStamp)
}

function scrollsUnder(event: WheelEvent, under: { tab: Tab; pane: HTMLElement; at: Element }) {
  if (event.defaultPrevented) return KEPT
  const ours = live?.tab.id === under.tab.id ? live : null
  if (ours && !ours.swipe.asking) return NEITHER
  if (slid.since(under.tab.paneId, ours?.first ?? event.timeStamp)) return KEPT
  if (event.deltaX === 0) return NEITHER
  return taken(chainOf(under.at, under.pane))
}

function wheeled(event: WheelEvent) {
  if (!swipeChoice.on || !fromTouchpad(event, live !== null)) return
  if (event.deltaX === 0 && event.deltaY === 0) return
  const under = tabUnder(event.target)
  if (!under) return
  heard({
    tab: under.tab,
    source: 'touchpad',
    dx: event.deltaX,
    dy: event.deltaY,
    at: event.timeStamp,
    scrolls: scrollsUnder(event, under),
  })
}

let finger: { tab: Tab; x: number; y: number; scrolls: Record<Side, boolean> } | null = null

function touched(event: TouchEvent) {
  finger = null
  if (live?.source === 'touch') end('dropped')
  const touch = event.touches[0]
  if (!swipeChoice.on || viewport.drawer || event.touches.length !== 1 || !touch) return
  const under = tabUnder(event.target)
  if (!under) return
  const room = roomOf(under.pane)
  const fromSide = touch.clientX - room.x <= SIDE || room.x + room.width - touch.clientX <= SIDE
  if (!fromSide) return
  finger = {
    tab: under.tab,
    x: touch.clientX,
    y: touch.clientY,
    scrolls: taken(chainOf(under.at, under.pane)),
  }
}

function moved(event: TouchEvent) {
  const touch = event.touches[0]
  if (!finger || !touch) return
  if (event.touches.length !== 1) {
    released(event)
    return
  }
  heard({
    tab: finger.tab,
    source: 'touch',
    dx: finger.x - touch.clientX,
    dy: finger.y - touch.clientY,
    at: event.timeStamp,
    scrolls: finger.scrolls,
  })
  finger.x = touch.clientX
  finger.y = touch.clientY
}

function released(event: TouchEvent) {
  finger = null
  if (live?.source === 'touch')
    end(event.type === 'touchcancel' ? 'dropped' : 'lifted', event.timeStamp)
}

export interface Said {
  tab: string
  kind: 'wheel' | 'touch' | 'lift'
  dx: number
  dy: number
  at: number
  left: boolean
  right: boolean
}

export function readSaid(value: unknown): Said | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  const { tab, kind, dx, dy, at, left, right } = said
  if (typeof tab !== 'string' || (kind !== 'wheel' && kind !== 'touch' && kind !== 'lift'))
    return null
  if (typeof dx !== 'number' || typeof dy !== 'number' || typeof at !== 'number') return null
  return { tab, kind, dx, dy, at, left: left === true, right: right === true }
}

export function readFingers(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null
  const { fingers } = value as Record<string, unknown>
  return typeof fingers === 'number' && Number.isInteger(fingers) && fingers >= 0 ? fingers : null
}

export function pageSaid(said: Said): void {
  if (said.kind === 'lift') {
    if (live?.tab.id === said.tab) end('lifted', said.at)
    return
  }
  const tab = workspace.tabs.find((one) => one.id === said.tab)
  if (tab?.kind !== 'web' || overlays.depth > 0) return
  const zoom = pages.of(tab.id).zoom || 1
  heard({
    tab,
    source: said.kind === 'touch' ? 'touch' : 'touchpad',
    dx: said.dx * zoom,
    dy: said.dy * zoom,
    at: said.at,
    scrolls: { left: said.left, right: said.right },
  })
}

function away() {
  if (document.visibilityState === 'hidden') end('dropped')
}

function unseen() {
  end('dropped')
  gone()
}

export function listen(): () => void {
  const target = document.createElement('div')
  document.body.append(target)
  const arrow = mount(SwipeArrow, { target, props: { unseen } })

  window.addEventListener('wheel', wheeled, { passive: true })
  window.addEventListener('scroll', scrolled, { capture: true, passive: true })
  document.addEventListener('visibilitychange', away)
  const touching = !isMobile
  if (touching) {
    window.addEventListener('touchstart', touched, { capture: true, passive: true })
    window.addEventListener('touchmove', moved, { capture: true, passive: true })
    window.addEventListener('touchend', released, { capture: true, passive: true })
    window.addEventListener('touchcancel', released, { capture: true, passive: true })
  }

  let unlisten: (() => void) | null = null
  let stopped = false
  if (isDesktop) {
    void import('../own-window').then(async ({ hearHere }) => {
      const off = await hearHere('nib://web-swipe', (event) => {
        const said = readSaid(event.payload)
        if (said) pageSaid(said)
      })
      const offPad = await hearHere('nib://touchpad', (event) => {
        const fingers = readFingers(event.payload)
        if (fingers !== null) touchpad(fingers)
      })
      const both = () => {
        off()
        offPad()
      }
      if (stopped) both()
      else unlisten = both
    })
  }

  return () => {
    stopped = true
    unlisten?.()
    window.removeEventListener('wheel', wheeled)
    window.removeEventListener('scroll', scrolled, { capture: true })
    document.removeEventListener('visibilitychange', away)
    slid.forget()
    if (touching) {
      window.removeEventListener('touchstart', touched, { capture: true })
      window.removeEventListener('touchmove', moved, { capture: true })
      window.removeEventListener('touchend', released, { capture: true })
      window.removeEventListener('touchcancel', released, { capture: true })
    }
    end('dropped')
    gone()
    settling = 0
    pad.known = false
    pad.down = false
    void unmount(arrow)
    target.remove()
  }
}
