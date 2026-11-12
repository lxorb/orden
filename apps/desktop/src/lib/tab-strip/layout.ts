export const WIDTH = {
  standard: 238,
  active: 38,
  inactive: 14,
  icon: 46,
} as const

const INSET = 3 + 8

export const PLUS_GAP = 4
export const PLUS = 28 + 2 * PLUS_GAP

export function plusFits(strip: number, lead: number): boolean {
  return strip <= 0 || strip >= lead + WIDTH.active + PLUS
}

const MARK = 16
const CLOSE = 16 + 4

const CLOSE_FROM = 68
const CLOSE_FROM_TOUCH = 100

export interface Sized {
  readonly icon: boolean
  readonly active: boolean
  readonly fit?: number | undefined
}

const LABEL_GAP = 6

export interface Trailing {
  reading?: boolean
  sound?: boolean
  shared?: boolean
  draft?: boolean
  faces?: number
  dots?: number
}

export function trailing(marks: Trailing): number {
  const people = (marks.faces ?? 0) * 14 + (marks.dots ?? 0) * 3
  return (
    (marks.reading ? 6 + 13 : 0) +
    (marks.sound ? 6 + 13 : 0) +
    (marks.shared ? 4 + 13 : 0) +
    (marks.draft ? 6 + 6 : 0) +
    (people > 0 ? 6 + people : 0)
  )
}

export function fitted(name: number, trailing = 0): number {
  const contents = MARK + LABEL_GAP + name + trailing + CLOSE
  return Math.ceil(2 * INSET + Math.max(contents, CLOSE_FROM))
}

export interface Bounds {
  x: number
  width: number
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

const lerp = (from: number, to: number, at: number): number => from + (to - from) * at

const sum = (values: readonly number[]): number => values.reduce((all, one) => all + one, 0)

function limits(tab: Sized): { least: number; crossover: number; preferred: number } {
  if (tab.icon) return { least: WIDTH.icon, crossover: WIDTH.icon, preferred: WIDTH.icon }

  return {
    least: tab.active ? WIDTH.active : WIDTH.inactive,
    crossover: WIDTH.active,
    preferred: preferredOf(tab),
  }
}

function preferredOf(tab: Sized): number {
  return tab.fit === undefined ? WIDTH.standard : clamp(tab.fit, WIDTH.active, WIDTH.standard)
}

export function widthsFor(tabs: readonly Sized[], room: number | null): number[] {
  const sizes = tabs.map(limits)
  if (room === null) return sizes.map((one) => one.preferred)

  const least = sum(sizes.map((one) => one.least))
  const crossover = sum(sizes.map((one) => one.crossover))
  const preferred = sum(sizes.map((one) => one.preferred))

  const roomy = room >= crossover
  const share = roomy
    ? preferred === crossover
      ? 1
      : clamp((room - crossover) / (preferred - crossover), 0, 1)
    : crossover === least
      ? 1
      : clamp((room - least) / (crossover - least), 0, 1)

  const widths = sizes.map((one) =>
    Math.floor(
      roomy ? lerp(one.crossover, one.preferred, share) : lerp(one.least, one.crossover, share),
    ),
  )

  if (share <= 0 || share >= 1) return widths

  let spare = Math.floor(room - sum(widths))
  return widths.map((width, at) => {
    const one = sizes[at]
    const grows = !!one && (roomy ? one.crossover < one.preferred : one.least < one.crossover)
    if (spare <= 0 || !grows) return width

    spare -= 1
    return width + 1
  })
}

export const OPENED_LEAST = 160

export function widened(
  widths: readonly number[],
  at: number,
  room: number | null,
  fit?: number,
): number[] {
  const now = widths[at]
  if (now === undefined) return [...widths]
  const free = room === null ? 0 : Math.max(0, room - sum(widths))
  const most = fit === undefined ? WIDTH.standard : clamp(fit, WIDTH.icon, WIDTH.standard)
  const wide = Math.max(Math.min(OPENED_LEAST, most), Math.min(most, now + free))
  return widths.map((width, index) => (index === at ? Math.max(width, wide) : width))
}

export function placed(widths: readonly number[]): Bounds[] {
  let x = 0
  return widths.map((width) => {
    const one = { x, width }
    x += width
    return one
  })
}

export function endOf(bounds: readonly Bounds[]): number {
  const last = bounds[bounds.length - 1]
  return last ? last.x + last.width : 0
}

export interface Parts {
  mark: boolean
  close: boolean
  title: boolean
  centred: boolean
}

export function partsFor(width: number, tab: Sized, touch = false): Parts {
  if (width < WIDTH.inactive) return { mark: false, close: false, title: false, centred: false }
  if (tab.icon) return { mark: true, close: false, title: false, centred: false }

  const contents = width - 2 * INSET
  let left = contents

  if (tab.active) {
    left -= CLOSE
    const mark = left >= MARK
    if (mark) left -= MARK
    return { mark, close: true, title: left > 0, centred: false }
  }

  const close = contents >= (touch ? CLOSE_FROM_TOUCH : CLOSE_FROM)
  const mark = left >= MARK
  if (mark) left -= MARK
  if (close) left -= CLOSE

  if (!close && !mark) return { mark: true, close: false, title: false, centred: true }
  return { mark, close, title: left > 0, centred: false }
}

export const OPENING = 210

export function crossTakes(id: string, opened: string | null, settled: string | null): boolean {
  return id !== opened || settled === opened
}

export function slotAt(bounds: readonly Bounds[], along: number): number {
  return bounds.filter((one) => one.x + one.width / 2 < along).length
}

export function moved<T>(order: readonly T[], from: number, to: number): T[] {
  const rest = order.filter((_, at) => at !== from)
  const one = order[from]
  if (one === undefined) return [...order]

  return [...rest.slice(0, to), one, ...rest.slice(to)]
}

function startIf(widths: readonly number[], from: number, to: number): number {
  return sum(moved(widths, from, to).slice(0, to))
}

export function nearestSlot(
  widths: readonly number[],
  from: number,
  x: number,
  current = from,
): number {
  const low = 0
  const high = widths.length - 1

  let best = clamp(current, low, high)
  let nearest = Math.abs(x - startIf(widths, from, best))

  for (let to = low; to <= high; to++) {
    const away = Math.abs(x - startIf(widths, from, to))
    if (away < nearest) {
      nearest = away
      best = to
    }
  }

  return best
}

export function reorderSlack(width: number): number {
  return Math.round((16 * width) / WIDTH.standard)
}

export function clampedStart(x: number, width: number, room: number): number {
  return clamp(x, 0, Math.max(0, room - width))
}

export const MAGNETISM = { mouse: 15, touch: 50 } as const

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export function holds(strip: Rect, x: number, y: number, magnetism: number): boolean {
  return (
    x >= strip.left &&
    x < strip.right &&
    y >= strip.top - magnetism &&
    y <= strip.bottom + magnetism
  )
}

const CLOSING_SLOP = { below: 40, past: 60 } as const

export function near(strip: Rect, x: number, y: number): boolean {
  return (
    x >= strip.left &&
    x <= strip.right + CLOSING_SLOP.past &&
    y >= strip.top &&
    y <= strip.bottom + CLOSING_SLOP.below
  )
}

export function keptWidths(
  tabs: readonly (Sized & { id: string })[],
  kept: ReadonlyMap<string, number>,
): number[] | null {
  const widths: number[] = []

  for (const tab of tabs) {
    const width = kept.get(tab.id)
    if (width === undefined) return null
    widths.push(tab.active && !tab.icon ? Math.max(width, WIDTH.active) : width)
  }

  return widths
}

export function worthKeeping(tabs: readonly Sized[], room: number | null): boolean {
  if (room === null) return false
  return sum(tabs.map((one) => limits(one).preferred)) > room
}

export function separated(ids: readonly string[], filled: ReadonlySet<string>): Set<string> {
  const shown = new Set<string>()

  for (let at = 0; at < ids.length - 1; at++) {
    const here = ids[at]
    const next = ids[at + 1]
    if (here && next && !filled.has(here) && !filled.has(next)) shown.add(here)
  }

  return shown
}
