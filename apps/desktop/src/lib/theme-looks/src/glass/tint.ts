import type { Scheme } from '@orden/contracts'
import { AA, hexOf, type Lift, over, type Rgb, rgbOf, scrimFloor, type Span } from '../../../ui-controls/src/api'
import type { Palette } from '../wallpaper/floors'
import { along, type Stops } from './pairs'

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
}
export interface Dials {
  strength: number
}
export const DIALS: Dials = { strength: 1 }
export interface Bar {
  colour: string
  scheme: Scheme
}
export const PAGE_WASH = 0.8
export const MARK_TONE = 0.22
const TONES = [MARK_TONE, 0.16, 0.11, 0.06, 0]
const HOVER = 0.1
export const GRAIN = 0.025
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
function stacks(side: Palette, grain = 0): Lift[][] {
  const hover = { colour: side.text, alpha: HOVER }
  const own = [[], [hover], [side.layer], [side.layer, hover]]
  if (grain <= 0) return own
  return [WHITE, BLACK].flatMap((speck) => own.map((stack) => [{ colour: speck, alpha: grain }, ...stack]))
}
function other(scheme: Scheme): Scheme {
  return scheme === 'dark' ? 'light' : 'dark'
}
const AIM = AA + 0.1
function floorOf(side: Palette, scrim: Rgb, span: Span, aim = AIM, grain = 0): number {
  return stacks(side, grain)
    .map((lifts) => scrimFloor(side.ink, scrim, span, lifts, aim))
    .reduce((high, one) => Math.max(high, one), -Infinity)
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
export function frameFor(source: Source, app: Scheme, sides: Sides, paper: Rgb, dials: Dials = DIALS): Frame {
  const span: Span = { least: paper, most: paper }
  const strength = Math.min(1, Math.max(0, dials.strength))
  let scheme: Scheme
  let tint: Rgb
  let stated: number
  if (source.page) {
    const bar = barFor(source.colour, app, sides)
    scheme = bar.scheme
    const solid = rgbOf(bar.colour) ?? source.colour
    tint = rgbOf(hexOf(over(solid, strength, sides[scheme].scrim))) ?? solid
    stated = PAGE_WASH
  } else {
    scheme = app
    const own = sides[app]
    const tone = TONES.map((amount) => rgbOf(hexOf(over(source.colour, amount * strength, own.scrim))))
    tint = tone.find((one): one is Rgb => one !== null && carries(own, one)) ?? own.scrim
    stated = 1
  }
  const side = sides[scheme]
  const lift = floorOf(side, side.scrim, { least: tint, most: tint })
  if (lift > 0) tint = rgbOf(hexOf(over(side.scrim, lift, tint))) ?? tint
  const wash = Math.max(stated, floorOf(side, tint, span))
  return { scheme, tint: hexOf(tint), wash }
}
function written(colour: Rgb): Rgb {
  return rgbOf(hexOf(colour)) ?? colour
}
export function pairFor(stops: Stops, app: Scheme, sides: Sides, dials: Dials = DIALS): Frame & { second: string } {
  const strength = Math.min(1, Math.max(0, dials.strength))
  const side = sides[app]
  const toned = stops.map((one) => written(over(one, strength, side.scrim)))
  const lift = along([toned[0] ?? side.scrim, toned[1] ?? side.scrim])
    .map((one) => floorOf(side, side.scrim, { least: one, most: one }, AIM, GRAIN))
    .reduce((high, one) => Math.max(high, one), -Infinity)
  const [first, second] = toned.map((one) => (lift > 0 ? written(over(side.scrim, lift, one)) : one)) as [Rgb, Rgb]
  return { scheme: app, tint: hexOf(first), second: hexOf(second), wash: 1 }
}
