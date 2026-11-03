/** A download, seen going: the file flies from where it was asked for to the downloads
 *  glyph, and the glyph answers when it lands (#1048). Said too, through the app's one
 *  live region, for whoever is listening rather than looking.
 *
 *  Where it starts, best first: the control it was asked for by; else the last press
 *  in the window, the element if it is still there and the pointer if not - a menu's
 *  row has closed by the time a save dialog has been answered; else the middle of the
 *  panes. A web page's download starts in the middle of that page, because what was
 *  pressed inside a page is the page's own and the window never heard it.
 *
 *  Where it lands, best first: the glyph in the bar of the tab that is saving it, then
 *  the glyph in the pane that has the focus, then any glyph on screen. A bar that is
 *  out of sight - a page holding the whole screen, a tab behind another - is no place
 *  to land, and with no glyph on screen at all the file goes to the corner of the
 *  window at the end of the strip, where a browser keeps its downloads, and fades there.
 *
 *  An arc of 400 to 600 milliseconds, longer the further it goes, and only a transform
 *  and an opacity, so the compositor draws it and nothing is laid out again. Each file
 *  its own flight; a burst of them leaves one after another rather than as one, and
 *  past a handful only the glyph answers. Nothing waits on a flight and nothing is held
 *  by one: it takes no press, it ends early when the window changes size, and the
 *  glyph's answer starts over when the next file lands. A reader who asked for less
 *  movement gets no flight: the glyph answers in place, and its ring says the rest.
 *
 *  A page is a native webview drawn over the window's HTML (see web-tab/covers.ts),
 *  so a flight over one is cut out of it where the engine can cut, and on an engine
 *  that cannot - which would hide the whole page behind a still for half a second -
 *  the flight leaves from the top edge of the page instead, out from under the bar. */

import FileIcon from 'lucide/dist/esm/icons/file.mjs'
import { t } from '../i18n.svelte'
import { calm, dur, stillness } from '../motion'
import { said } from '../said.svelte'
import { lastPress, type Origin, type Press } from './started'
import {
  cornerOf,
  flightMs,
  framesOf,
  landing,
  middleOf,
  startOf,
  type Box,
  type Glyph,
  type Point,
} from './path'

/** The size of the file that flies, in pixels. */
const SIZE = 28

/** How many files fly at once. A burst of forty is forty answers of the glyph and
 *  five flights, not forty things crossing the window. */
const AT_ONCE = 5

/** How far apart the files of a burst leave. */
const APART = 70

// ---------------------------------------------------------------------------------
// On the window.

function boxOf(node: Element): Box {
  const box = node.getBoundingClientRect()
  return { x: box.x, y: box.y, width: box.width, height: box.height }
}

/** An element's box, if it is drawn and on screen: nothing hidden with the bar it is
 *  in, nothing of no size, nothing outside the window. */
function shown(node: Element | null | undefined): Box | null {
  if (!node?.isConnected) return null
  if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) return null
  const box = boxOf(node)
  if (box.width === 0 || box.height === 0) return null
  if (box.x + box.width <= 0 || box.y + box.height <= 0) return null
  if (box.x >= innerWidth || box.y >= innerHeight) return null
  return box
}

const GLYPHS = '[data-opens="downloads"]'

function glyphsOnScreen(): { node: HTMLElement; glyph: Glyph }[] {
  const focusedPane = document.activeElement?.closest('[data-pane]') ?? null
  const found: { node: HTMLElement; glyph: Glyph }[] = []
  for (const node of document.querySelectorAll<HTMLElement>(GLYPHS)) {
    const box = shown(node)
    if (!box) continue
    found.push({
      node,
      glyph: {
        box,
        tab: node.dataset.tab ?? null,
        focused: focusedPane?.contains(node) === true,
      },
    })
  }
  return found
}

function areaOf(): Box {
  const panes = shown(document.querySelector('[data-panes]'))
  return panes ?? { x: 0, y: 0, width: innerWidth, height: innerHeight }
}

/** Whether a web tab is anywhere in the window, which is when a flight may cross a
 *  page. Asked before the web tabs' store is, so a window with none never fetches it. */
function pagesInWindow(): boolean {
  return document.querySelector('.webbar') !== null
}

/** Whether the engine cuts the app's layers out of a page; see covers.ts. */
async function engineCuts(): Promise<boolean> {
  if (!pagesInWindow()) return false
  const { pages } = await import('../web-tab/pages.svelte')
  return pages.cuts
}

/** Where a web tab's page is, as a place a flight leaves from: its middle where the
 *  engine cuts a flight out of it, else the top edge, under its bar. */
function pageOf(tab: string, cuts: boolean): Point | null {
  const glyph = [...document.querySelectorAll<HTMLElement>(GLYPHS)].find(
    (one) => one.dataset.tab === tab,
  )
  const pane = shown(glyph?.closest('[data-pane]'))
  if (!glyph || !pane) return null
  const bar = shown(glyph.closest('.webbar'))
  if (cuts || !bar) return middleOf(pane)
  return { x: pane.x + pane.width / 2, y: bar.y + bar.height }
}

const flying = new Set<Animation>()
const answering = new WeakMap<Element, Animation>()

/** The glyph's answer to a file landing: a bounce, or for a reader who asked for less
 *  movement a dip of its strength, which moves nothing. Started over by the next. */
function answer(node: Element): void {
  if (typeof node.animate !== 'function') return
  answering.get(node)?.cancel()
  const still = stillness()
  const frames: Keyframe[] = still
    ? [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }]
    : [
        { transform: 'scale(1)' },
        { transform: 'scale(1.25)', offset: 0.35 },
        { transform: 'scale(0.95)', offset: 0.7 },
        { transform: 'scale(1)' },
      ]
  const timing = still ? { duration: calm(480) } : { duration: dur(360) }
  answering.set(node, node.animate(frames, { ...timing, easing: 'ease-out' }))
}

function fileGlyph(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  for (const [tag, attrs] of FileIcon) {
    const part = document.createElementNS('http://www.w3.org/2000/svg', tag)
    for (const [name, value] of Object.entries(attrs)) part.setAttribute(name, String(value))
    svg.append(part)
  }
  Object.assign(svg.style, {
    width: '16px',
    height: '16px',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.75',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  })
  return svg
}

/** The file that flies: a small card in the accent with the file glyph on it, fixed
 *  over the window, taking no press. Cut out of a page where the engine cuts
 *  (`nib-flight`; see covers.ts). */
function flyer(at: Point, cut: boolean): HTMLElement {
  const node = document.createElement('div')
  if (cut) node.className = 'nib-flight'
  node.setAttribute('aria-hidden', 'true')
  node.dataset.flight = ''
  Object.assign(node.style, {
    position: 'fixed',
    left: `${String(at.x - SIZE / 2)}px`,
    top: `${String(at.y - SIZE / 2)}px`,
    width: `${String(SIZE)}px`,
    height: `${String(SIZE)}px`,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '8px',
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    boxShadow: 'var(--shadow-md)',
    pointerEvents: 'none',
    zIndex: 'var(--z-carried)',
    opacity: '0',
    willChange: 'transform, opacity',
  })
  node.append(fileGlyph())
  return node
}

/** Ends every flight still in the air, at once: the window changed size and where
 *  they were going is not where the glyph is now. */
export function stopFlights(): void {
  for (const one of [...flying]) one.finish()
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  window.addEventListener('resize', stopFlights, { passive: true })
}

/** Two frames, so a glyph the first download brings into the bar is laid out before
 *  it is looked for, and a tab a download closes has gone. */
function settled(): Promise<void> {
  return new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()))
  })
}

/** A download has started; see started.ts. */
export async function started(
  name: string,
  from: Origin,
  press: Press | null = lastPress(),
): Promise<void> {
  said.say(t('Downloading {name}', { name }))
  const element = shown(from.element)
  await settled()
  // The last wait: from here to the flight leaving nothing yields, so a burst counts
  // the flights already in the air rightly.
  const cuts = await engineCuts()

  const glyphs = glyphsOnScreen()
  const target = landing(
    glyphs.map((one) => one.glyph),
    from.tab ?? null,
  )
  const node = target ? glyphs.find((one) => one.glyph === target)?.node : undefined

  if (stillness() || typeof document.body.animate !== 'function') {
    if (node) answer(node)
    return
  }
  if (flying.size >= AT_ONCE) {
    if (node) answer(node)
    return
  }

  // A page's file: the page saving it, else the page it was handed back to - a tab a
  // download link opened closes as the file starts (`downloaded` in pages.svelte.ts).
  // Never the window's last press, which was not in the page.
  const page = from.tab
    ? (pageOf(from.tab, cuts) ??
      (target?.tab ? pageOf(target.tab, cuts) : null) ??
      middleOf(areaOf()))
    : null
  const start = startOf({
    element,
    page,
    press,
    pressed: shown(press?.target),
    now: performance.now(),
    area: areaOf(),
  })
  const end = target
    ? middleOf(target.box)
    : cornerOf(
        { width: innerWidth, height: innerHeight },
        getComputedStyle(document.documentElement).direction === 'rtl',
      )

  listen()
  const card = flyer(start, cuts)
  document.body.append(card)
  const flight = card.animate(framesOf(start, end, target !== null), {
    duration: dur(flightMs(start, end)),
    delay: flying.size * APART,
    easing: 'linear',
    fill: 'backwards',
  })
  flying.add(flight)

  const done = () => {
    flying.delete(flight)
    card.remove()
  }
  flight.onfinish = () => {
    done()
    if (node?.isConnected) answer(node)
  }
  flight.oncancel = done
}
