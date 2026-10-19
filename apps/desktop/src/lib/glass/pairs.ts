/** Glass's own colours: the two the frame is a soft diagonal of wherever it is not
 *  following a page - a note, a canvas, a chat, the settings, an empty pane.
 *
 *  The role models are the desks people already like looking at behind a translucent
 *  window: a Mac's Sequoia wallpaper, Arc's space gradients, iOS's mesh gradients,
 *  Linear's glows. What they share is what this keeps: two colours and no more, low in
 *  saturation, one in a corner each - the first top left, the second bottom right - and
 *  a blend so long and soft it reads as light rather than as a gradient. Under the dark
 *  scheme each pair is a deeper, greyer version of itself, so the frame is calm at night
 *  too.
 *
 *  A pair the app offers names both shades of each colour, the way an accent does,
 *  because a pastel that is right under dark words is wrong under light ones. A pair of
 *  the reader's own is two colours as picked: worn as they are on the light side, and
 *  laid thinly over the dark side's chrome where they are too light for it. tint.ts
 *  then holds every word on the frame to AA over every colour between the two.
 *
 *  Pure; see pairs.test.ts. */

import { accentColour } from '../accents'
import { luminance, over, type Rgb, rgbOf } from '../legibility'

export type Scheme = 'dark' | 'light'

/** Two colours, the first for the top left corner. */
export type Stops = readonly [Rgb, Rgb]

/** A pair the app offers, in the shades each scheme needs. */
export interface Pair {
  id: string
  name: string
  light: readonly [string, string]
  dark: readonly [string, string]
}

/** Where everybody starts: a light blue going to a soft pink-purple, which is also the
 *  app icon's pair.
 *
 *  Every pair's shades are as strong as they can be while the quietest word on a row
 *  under the pointer still reads on them at AA with the grain, and while no more than
 *  four fifths of them over Mica does - so the material still shows at the window's
 *  edges, and the Opacity dial still has room. pairs.test.ts holds them to both. */
export const DAWN: Pair = {
  id: 'dawn',
  name: 'Dawn',
  light: ['#d2e7fc', '#eed7f2'],
  dark: ['#1d2a3d', '#30243d'],
}

export const PAIRS: readonly Pair[] = [
  DAWN,
  { id: 'lagoon', name: 'Lagoon', light: ['#d1f0e7', '#d1dff9'], dark: ['#182d2c', '#1b273b'] },
  { id: 'lilac', name: 'Lilac', light: ['#e5dbf9', '#d5defa'], dark: ['#28233d', '#202840'] },
  { id: 'peach', name: 'Peach', light: ['#fce7d6', '#f5d6e2'], dark: ['#332623', '#32202e'] },
  { id: 'sage', name: 'Sage', light: ['#d3e5cf', '#efe3c6'], dark: ['#1f2b23', '#2b281f'] },
  { id: 'mist', name: 'Mist', light: ['#dfe5ec', '#e9e4ec'], dark: ['#232830', '#2b2730'] },
]

/** The reader's accent, one colour in both corners: the frame glass always had. */
export const ACCENT_PAIR = 'accent'

/** A pair of the reader's own, as it is kept: the two colours, space apart. */
const OWN = /^(#[0-9a-f]{6}) (#[0-9a-f]{6})$/

/** Whether a kept value is two colours of the reader's own. */
export function isOwn(value: unknown): value is string {
  return typeof value === 'string' && OWN.test(value)
}

/** Two colours as one value to keep. */
export function ownOf(first: string, second: string): string {
  return `${first.toLowerCase()} ${second.toLowerCase()}`
}

/** How much of an own colour lies over the dark side's chrome where it is too light to
 *  be worn there as it is: a deep version of it, rather than the pastel turned grey. */
const DEEP = 0.15

/** An own colour is too light for the dark side above this luminance - about where the
 *  dark side's quiet words stop reading on it. */
const TOO_LIGHT = 0.12

/** The two colours a value names, in this scheme; `scrim` is the dark side's chrome,
 *  which a light own colour is laid over there. Anything the value cannot mean is the
 *  pair everybody starts with. */
export function stopsOf(value: unknown, scheme: Scheme, accent: string, scrim: Rgb): Stops {
  if (value === ACCENT_PAIR) {
    const colour = rgbOf(accentColour(accent, scheme)) ?? scrim
    return [colour, colour]
  }

  const own = typeof value === 'string' ? OWN.exec(value) : null
  if (own) {
    const picked = [own[1], own[2]].map((one) => rgbOf(one ?? '') ?? scrim)
    const worn = picked.map((one) =>
      scheme === 'dark' && luminance(one) > TOO_LIGHT ? over(one, DEEP, scrim) : one,
    )
    return [worn[0] ?? scrim, worn[1] ?? scrim]
  }

  const pair = PAIRS.find((one) => one.id === value) ?? DAWN
  const [first, second] = pair[scheme]
  return [rgbOf(first) ?? scrim, rgbOf(second) ?? scrim]
}

/** The two colours a value shows as where it is picked: a pair's shades in this scheme,
 *  the accent's, or the reader's own as they picked them. */
export function shownOf(value: unknown, scheme: Scheme, accent: string): readonly [string, string] {
  if (value === ACCENT_PAIR) {
    const colour = accentColour(accent, scheme)
    return [colour, colour]
  }
  const own = typeof value === 'string' ? OWN.exec(value) : null
  if (own?.[1] && own[2]) return [own[1], own[2]]
  return (PAIRS.find((one) => one.id === value) ?? DAWN)[scheme]
}

/** How finely the blend is checked: every colour between the two corners is a mix of
 *  them, and luminance is not straight along that line, so a word that reads on both
 *  corners is checked on the way between them too. */
const STEPS = 8

/** The colours the blend passes through, the corners included. */
export function along(stops: Stops): Rgb[] {
  const [first, second] = stops
  return Array.from({ length: STEPS + 1 }, (_, step) => over(second, step / STEPS, first))
}

/** What a swatch of a pair is painted with, in this scheme. */
export function swatchOf(pair: Pair, scheme: Scheme): string {
  const [first, second] = pair[scheme]
  return `linear-gradient(135deg, ${first}, ${second})`
}
