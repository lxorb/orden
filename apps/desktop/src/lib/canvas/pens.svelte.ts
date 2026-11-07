import { keepJson, stored } from '../stored'
import { clampOpacity, type InkTool, isInkTool } from './format'
import { INK_STYLES } from './ink'
import { DEFAULT_INK } from './palette'

export interface Nib {
  tool: InkTool
  size: number
  opacity: number
  colour: string
}

export const DOCKS = ['top', 'bottom', 'left', 'right'] as const
export type Dock = (typeof DOCKS)[number]

export function upright(dock: Dock): boolean {
  return dock === 'left' || dock === 'right'
}

export function nearestDock(at: { x: number; y: number }, width: number, height: number): Dock {
  const away: [Dock, number][] = [
    ['left', at.x],
    ['right', Math.max(0, width - at.x)],
    ['top', at.y],
    ['bottom', Math.max(0, height - at.y)],
  ]

  let best: Dock = 'bottom'
  let least = Infinity
  for (const [dock, gap] of away) {
    if (gap >= least) continue

    least = gap
    best = dock
  }

  return best
}

export const PEN_SLOTS = 3

export const MOST_RECENT = 6

export const LEAST_WIDTH = 0.5
export const MOST_WIDTH = 30

export const LEAST_RUB = 2
export const MOST_RUB = 64
export const RUB = 10
export const STROKE_RUB = 2

export function drawnWidth(size: number, scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return size
  return Math.max(0.1, Math.round((size / scale) * 100) / 100)
}

export function shownWidth(size: number, scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return size
  return Math.round(size * scale * 10) / 10
}

export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return 3
  return Math.min(MOST_WIDTH, Math.max(LEAST_WIDTH, Math.round(value * 10) / 10))
}

export function clampRub(value: number): number {
  if (!Number.isFinite(value)) return RUB
  return Math.min(MOST_RUB, Math.max(LEAST_RUB, Math.round(value)))
}

export function nibFor(tool: InkTool, colour = DEFAULT_INK): Nib {
  const style = INK_STYLES[tool]
  return { tool, size: style.size, opacity: style.opacity, colour }
}

function fresh(): Nib[] {
  return [nibFor('pen'), nibFor('pencil'), nibFor('highlighter')]
}

function three(held: Nib[]): Nib[] {
  const row = fresh()
  return row.map((one, index) => held[index] ?? one)
}

interface Kept {
  pens: Nib[]
  at: number
  recent: string[]
  dock: Dock
  shut: boolean
  whole: boolean
  rub: number
  strokeRub: number
  straighten: boolean
  box: boolean
  partly: boolean
}

const KEY = 'orden:pens'

function blank(): Kept {
  return {
    pens: fresh(),
    at: 0,
    recent: [],
    dock: 'bottom',
    shut: false,
    whole: false,
    rub: RUB,
    strokeRub: STROKE_RUB,
    straighten: true,
    box: false,
    partly: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function oneNib(held: unknown): Nib[] {
  if (!isRecord(held) || !isInkTool(held.tool)) return []

  const style = INK_STYLES[held.tool]
  return [
    {
      tool: held.tool,
      size: typeof held.size === 'number' ? clampSize(held.size) : style.size,
      opacity: typeof held.opacity === 'number' ? clampOpacity(held.opacity) : style.opacity,
      colour: typeof held.colour === 'string' && held.colour ? held.colour : DEFAULT_INK,
    },
  ]
}

export function readPens(raw: string | null): Kept {
  if (raw === null) return blank()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return blank()
  }

  return keptFrom(parsed)
}

function keptFrom(parsed: unknown): Kept {
  if (!isRecord(parsed)) return blank()

  const held = parsed
  const pens = three(Array.isArray(held.pens) ? held.pens.flatMap(oneNib) : [])

  return {
    pens,
    at:
      typeof held.at === 'number' ? Math.min(Math.max(0, Math.trunc(held.at)), pens.length - 1) : 0,
    recent: Array.isArray(held.recent)
      ? held.recent.filter((one): one is string => typeof one === 'string').slice(0, MOST_RECENT)
      : [],
    dock: DOCKS.find((one) => one === held.dock) ?? 'bottom',
    shut: held.shut === true,
    whole: held.whole === true,
    rub: typeof held.rub === 'number' ? clampRub(held.rub) : RUB,
    strokeRub: typeof held.strokeRub === 'number' ? clampRub(held.strokeRub) : STROKE_RUB,
    straighten: held.straighten !== false,
    box: held.box === true,
    partly: held.partly === true,
  }
}

class Pens {
  list = $state<Nib[]>([])
  at = $state(0)
  recent = $state<string[]>([])
  dock = $state<Dock>('bottom')
  shut = $state(false)
  whole = $state(false)
  rub = $state(RUB)
  strokeRub = $state(STROKE_RUB)
  straighten = $state(true)
  box = $state(false)
  partly = $state(false)

  constructor() {
    this.restore(keptFrom(stored(KEY)))
  }

  get current(): Nib {
    return this.list[this.at] ?? nibFor('pen')
  }

  get eraser(): { whole: boolean; size: number; stroke: number } {
    return { whole: this.whole, size: this.rub, stroke: this.strokeRub }
  }

  pick(index: number) {
    if (index < 0 || index >= this.list.length || index === this.at) return

    this.at = index
    this.keep()
  }

  set(changed: Partial<Nib>) {
    const one = this.list[this.at]
    if (!one) return

    const next: Nib = { ...one, ...changed }
    if (
      next.tool === one.tool &&
      next.size === one.size &&
      next.opacity === one.opacity &&
      next.colour === one.colour
    ) {
      return
    }

    this.list = this.list.map((pen, index) => (index === this.at ? next : pen))
    if (changed.colour !== undefined) this.remember(changed.colour)
    this.keep()
  }

  remember(colour: string) {
    if (!colour.startsWith('#')) return

    this.recent = [colour, ...this.recent.filter((one) => one !== colour)].slice(0, MOST_RECENT)
  }

  fold(shut: boolean) {
    if (this.shut === shut) return

    this.shut = shut
    this.keep()
  }

  dockTo(dock: Dock) {
    if (this.dock === dock) return

    this.dock = dock
    this.keep()
  }

  rubbing(changed: { whole?: boolean; rub?: number; strokeRub?: number }) {
    if (changed.whole !== undefined) this.whole = changed.whole
    if (changed.rub !== undefined) this.rub = clampRub(changed.rub)
    if (changed.strokeRub !== undefined) this.strokeRub = clampRub(changed.strokeRub)
    this.keep()
  }

  catching(changed: { box?: boolean; partly?: boolean }) {
    if (changed.box !== undefined) this.box = changed.box
    if (changed.partly !== undefined) this.partly = changed.partly
    this.keep()
  }

  straightening(on: boolean) {
    if (this.straighten === on) return

    this.straighten = on
    this.keep()
  }

  restore(held: Kept) {
    this.list = held.pens
    this.at = held.at
    this.recent = held.recent
    this.dock = held.dock
    this.shut = held.shut
    this.whole = held.whole
    this.rub = held.rub
    this.strokeRub = held.strokeRub
    this.straighten = held.straighten
    this.box = held.box
    this.partly = held.partly
  }

  private keep() {
    const held: Kept = {
      pens: this.list,
      at: this.at,
      recent: this.recent,
      dock: this.dock,
      shut: this.shut,
      whole: this.whole,
      rub: this.rub,
      strokeRub: this.strokeRub,
      straighten: this.straighten,
      box: this.box,
      partly: this.partly,
    }

    keepJson(KEY, held)
  }
}

export const pens = new Pens()
