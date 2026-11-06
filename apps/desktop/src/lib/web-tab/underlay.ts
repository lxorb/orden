/** The window's own grounds with a hole where each page is, for an engine that draws its
 *  pages under the window's HTML (`'under'` in pages.svelte.ts, #1137).
 *
 *  The page is drawn below the app's webview, which is transparent: whatever of the
 *  window's HTML is not transparent at the page's place is drawn over the page. A layer
 *  over a page is meant to be; the grounds the window is painted on are not. The body,
 *  the shell, the chrome round the cards and the pane's card each paint all of their own
 *  box, so each of them, where a page is inside it, paints its ground in a layer of its
 *  own instead (`::before`, under everything it holds) cut to its box less the pages, and
 *  its own background is none. Nothing over the grounds is touched: a menu, a sheet or
 *  the tab overview is drawn over the page as it is over anything else.
 *
 *  `PAINTERS` is the list, and WebTab.svelte's style the ground each one paints. */

import type { Rect } from './pages.svelte'

export interface Hollow extends Rect {
  corner: number
  cut?: boolean
}

/** What paints a ground behind a page, outermost first: the order their layers are
 *  drawn in is the order they are in the document. */
const PAINTERS = ['body', 'main', 'main > .middle', '[data-pane]'] as const

/** Every page drawn under the window now, by tab. */
const holes = new Map<string, Hollow>()

/** The painters given a layer, and what each was given, so nothing is written twice. */
const given = new Map<HTMLElement, string>()

const ATTRIBUTE = 'data-underlay'
/** Within half a pixel, a page is inside its card. */
const SLACK = 0.5

function n(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** A rectangle with `round` at its four corners, or at its bottom two, as a path's
 *  commands. Pure. */
export function rounded(box: Rect, round: number, bottomOnly: boolean): string {
  const r = Math.max(0, Math.min(round, box.width / 2, box.height / 2))
  const [l, t, rt, b] = [box.x, box.y, box.x + box.width, box.y + box.height]
  const top = bottomOnly ? 0 : r
  return [
    `M${n(l + top)} ${n(t)}`,
    `H${n(rt - top)}`,
    top > 0 ? `A${n(top)} ${n(top)} 0 0 1 ${n(rt)} ${n(t + top)}` : '',
    `V${n(b - r)}`,
    r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(rt - r)} ${n(b)}` : '',
    `H${n(l + r)}`,
    r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(l)} ${n(b - r)}` : '',
    `V${n(t + top)}`,
    top > 0 ? `A${n(top)} ${n(top)} 0 0 1 ${n(l + top)} ${n(t)}` : '',
    'Z',
  ].join('')
}

function inside(hole: Rect, box: Rect): boolean {
  return (
    hole.x >= box.x - SLACK &&
    hole.y >= box.y - SLACK &&
    hole.x + hole.width <= box.x + box.width + SLACK &&
    hole.y + hole.height <= box.y + box.height + SLACK
  )
}

/** The shape a painter at `box`, with `round` at its corners, paints its ground in: all
 *  of its box less every page inside it that is cut round, in the box's own coordinates,
 *  or null where no page is inside it. Pure. */
export function groundOf(box: Rect, round: number, pages: readonly Hollow[]): string | null {
  const within = pages.filter((one) => one.width > 0 && one.height > 0 && inside(one, box))
  if (within.length === 0) return null
  const local = (one: Rect): Rect => ({ ...one, x: one.x - box.x, y: one.y - box.y })
  const outer = rounded(local({ ...box }), round, false)
  const cut = within
    .filter((one) => one.cut !== false)
    .map((one) => rounded(local(one), one.corner, true))
  return `path(evenodd, "${[outer, ...cut].join(' ')}")`
}

function cutWithin(box: Rect, pages: readonly Hollow[]): boolean {
  return pages.some((one) => one.cut !== false && inside(one, box))
}

function boxOf(node: Element): Rect {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

function painters(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(PAINTERS.join(', '))]
}

/** Each painter's layer, for the pages as they are now. */
function paint(): void {
  if (typeof document === 'undefined') return
  const all = [...holes.values()]
  const now = new Map<HTMLElement, Record<string, string>>()
  for (const one of all.length === 0 ? [] : painters()) {
    const box = boxOf(one)
    if (one.matches('[data-pane]') && !cutWithin(box, all)) continue
    const round = parseFloat(getComputedStyle(one).borderTopLeftRadius) || 0
    const shape = groundOf(box, round, all)
    if (!shape) continue
    now.set(one, {
      '--underlay-x': `${n(box.x)}px`,
      '--underlay-y': `${n(box.y)}px`,
      '--underlay-w': `${n(box.width)}px`,
      '--underlay-h': `${n(box.height)}px`,
      '--underlay-clip': shape,
    })
  }

  for (const [one, was] of given) {
    if (now.has(one)) continue
    one.removeAttribute(ATTRIBUTE)
    for (const name of Object.keys(JSON.parse(was) as Record<string, string>))
      one.style.removeProperty(name)
    given.delete(one)
  }
  for (const [one, props] of now) {
    const said = JSON.stringify(props)
    if (given.get(one) === said) continue
    for (const [name, value] of Object.entries(props)) one.style.setProperty(name, value)
    one.setAttribute(ATTRIBUTE, '')
    given.set(one, said)
  }
  document.documentElement.toggleAttribute(ATTRIBUTE, given.size > 0)
}

/** Where a tab's page is drawn under the window now, or null for nowhere: its tab left
 *  the front, it faded out, or it is not drawn under the window at all. */
export function underlaid(tab: string, hole: Hollow | null): void {
  const was = holes.get(tab)
  if (hole === null) {
    if (!was) return
    holes.delete(tab)
  } else {
    holes.set(tab, hole)
  }
  paint()
}

/** How much of a hole shows: its opacity times every one of its ancestors', and none for
 *  one that is not drawn at all. What a page under the window is drawn at, so a pane that
 *  fades fades its page with it. */
export function opacityOf(hole: Element): number {
  if (
    typeof hole.checkVisibility === 'function' &&
    !hole.checkVisibility({ visibilityProperty: true })
  )
    return 0
  let shown = 1
  for (let at: Element | null = hole; at; at = at.parentElement) {
    const own = parseFloat(getComputedStyle(at).opacity)
    if (Number.isFinite(own)) shown *= own
  }
  return shown
}

/** Whether the hole or anything holding it is in the middle of a change of its own -
 *  a fade, a slide - so the page is placed again on the next frame. */
export function fading(hole: Element): boolean {
  for (let at: Element | null = hole; at; at = at.parentElement) {
    if (typeof at.getAnimations !== 'function') return false
    if (at.getAnimations().some((one) => one.playState === 'running')) return true
  }
  return false
}
