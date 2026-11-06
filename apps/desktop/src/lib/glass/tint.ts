import { type PaperInks, paperFloor } from '../content-ground'
import {
  AA,
  hexOf,
  type Lift,
  over,
  type Rgb,
  rgbOf,
  scrimFloor,
  SHARP,
  type Span,
} from '../legibility'
import type { Palette } from '../wallpaper/floors'
import { along, type Stops } from './pairs'

export type Scheme = 'dark' | 'light'

export type Material = 'mica' | 'acrylic' | 'clear' | null

export type Sides = Record<Scheme, Palette>

export interface Source {
  colour: Rgb
  page: boolean
}

export interface Frame {
  scheme: Scheme
  tint: string
  second?: string
  wash: number
  floor: number
  paper: number
  terminal: number
}

export interface Dials {
  opacity: number
  strength: number
}

export const DIALS: Dials = { opacity: 0.5, strength: 1 }

export interface Bar {
  colour: string
  scheme: Scheme
}

export const PAGE_WASH = 0.8

export const MARK_TONE = 0.22
const TONES = [MARK_TONE, 0.16, 0.11, 0.06, 0]

export function spanUnder(material: Material, scheme: Scheme, paper: Rgb): Span {
  if (material === 'acrylic' || material === 'clear') {
    return { least: [0, 0, 0], most: [255, 255, 255] }
  }
  if (material === 'mica') {
    return scheme === 'dark'
      ? { least: [0, 0, 0], most: [58, 58, 58] }
      : { least: [192, 192, 192], most: [255, 255, 255] }
  }
  return { least: paper, most: paper }
}

const HOVER = 0.1

export const GRAIN = 0.025

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

function stacks(side: Palette, grain = 0): Lift[][] {
  const hover = { colour: side.text, alpha: HOVER }
  const own = [[], [hover], [side.layer], [side.layer, hover]]
  if (grain <= 0) return own
  return [WHITE, BLACK].flatMap((speck) =>
    own.map((stack) => [{ colour: speck, alpha: grain }, ...stack]),
  )
}

function other(scheme: Scheme): Scheme {
  return scheme === 'dark' ? 'light' : 'dark'
}

const AIM = AA + 0.1

function floorOf(side: Palette, scrim: Rgb, span: Span, aim = AIM, grain = 0): number {
  return Math.max(
    ...stacks(side, grain).map((lifts) => scrimFloor(side.ink, scrim, span, lifts, aim)),
  )
}

export function barFor(page: Rgb, app: Scheme, sides: Sides): Bar {
  const one = { least: page, most: page }
  const options = [app, other(app)].map((scheme) => {
    const side = sides[scheme]
    const alpha = floorOf(side, side.scrim, one)
    return { scheme, colour: hexOf(over(side.scrim, alpha, page)), alpha }
  })
  const [mine, theirs] = options as [(typeof options)[0], (typeof options)[0]]
  const chosen = theirs.alpha < mine.alpha ? theirs : mine
  return { colour: chosen.colour, scheme: chosen.scheme }
}

function carries(side: Palette, colour: Rgb): boolean {
  return floorOf(side, colour, { least: colour, most: colour }) === 0
}

export function frameFor(
  source: Source,
  app: Scheme,
  material: Material,
  sides: Sides,
  paper: Rgb,
  dials: Dials = DIALS,
  inks: PaperInks | null = null,
): Frame {
  const span = spanUnder(material, app, paper)
  const aim = material === 'clear' ? SHARP + (AIM - AA) : AIM
  const strength = Math.min(1, Math.max(0, dials.strength))

  let scheme: Scheme
  let tint: Rgb
  let stated: number
  if (source.page) {
    const bar = barFor(source.colour, app, sides)
    scheme = bar.scheme
    const solid = rgbOf(bar.colour) ?? source.colour
    tint = rgbOf(hexOf(over(solid, strength, sides[scheme].scrim))) ?? solid
    stated = material ? dials.opacity : PAGE_WASH
  } else {
    scheme = app
    const own = sides[app]
    const tone = TONES.map((amount) =>
      rgbOf(hexOf(over(source.colour, amount * strength, own.scrim))),
    )
    tint = tone.find((one): one is Rgb => one !== null && carries(own, one)) ?? own.scrim
    stated = material ? dials.opacity : 1
  }

  const side = sides[scheme]
  const lift = floorOf(side, side.scrim, { least: tint, most: tint }, aim)
  if (lift > 0) tint = rgbOf(hexOf(over(side.scrim, lift, tint))) ?? tint

  const floor = floorOf(side, tint, span, aim)
  const wash = Math.max(Math.min(1, stated), floor)
  const under: Span = { least: over(tint, wash, span.least), most: over(tint, wash, span.most) }
  return {
    scheme,
    tint: hexOf(tint),
    wash,
    floor,
    paper: inks ? paperFloor(inks, under) : 1,
    terminal: inks ? paperFloor(inks, under, true) : 1,
  }
}

function written(colour: Rgb): Rgb {
  return rgbOf(hexOf(colour)) ?? colour
}

function boxOf(colours: readonly Rgb[]): Span {
  const pick = (choose: (...all: number[]) => number) =>
    [0, 1, 2].map((at) => choose(...colours.map((one) => one[at] ?? 0))) as unknown as Rgb
  return { least: pick(Math.min), most: pick(Math.max) }
}

export function pairFor(
  stops: Stops,
  app: Scheme,
  material: Material,
  sides: Sides,
  paper: Rgb,
  dials: Dials = DIALS,
  inks: PaperInks | null = null,
): Frame & { second: string } {
  const span = spanUnder(material, app, paper)
  const aim = material === 'clear' ? SHARP + (AIM - AA) : AIM
  const strength = Math.min(1, Math.max(0, dials.strength))
  const side = sides[app]

  const toned = stops.map((one) => written(over(one, strength, side.scrim)))
  const lift = Math.max(
    ...along([toned[0] ?? side.scrim, toned[1] ?? side.scrim]).map((one) =>
      floorOf(side, side.scrim, { least: one, most: one }, aim, GRAIN),
    ),
  )
  const [first, second] = toned.map((one) =>
    lift > 0 ? written(over(side.scrim, lift, one)) : one,
  ) as [Rgb, Rgb]

  const blend = along([first, second])
  const floor = Math.max(...blend.map((one) => floorOf(side, one, span, aim, GRAIN)))
  const wash = Math.max(Math.min(1, material ? dials.opacity : 1), floor)

  const box = boxOf([
    ...blend.flatMap((one) => [over(one, wash, span.least), over(one, wash, span.most)]),
    ...blend,
  ])
  const under: Span = {
    least: over(BLACK, GRAIN, box.least),
    most: over(WHITE, GRAIN, box.most),
  }
  return {
    scheme: app,
    tint: hexOf(first),
    second: hexOf(second),
    wash,
    floor,
    paper: inks ? paperFloor(inks, under) : 1,
    terminal: inks ? paperFloor(inks, under, true) : 1,
  }
}
