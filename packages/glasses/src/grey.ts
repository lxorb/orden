/** The code theme in sixteen greys.
 *
 *  A palette tells keywords from strings by hue, and the panel has no hue. It
 *  has sixteen brightnesses, and drawing eight token kinds as eight of them
 *  puts most of them within one step of each other, which on glass is no
 *  difference at all. So brightness carries only part of the distinction and
 *  weight and slant carry the rest: six bands of grey, each band read plain,
 *  bold or italic, which is nine legible combinations out of the six.
 *
 *  Brightness is not taken from the palette's own luminance either, and that is
 *  deliberate. A palette is made for paper or for a dark window, where a
 *  keyword may well be the darkest thing on the line; the panel draws light on
 *  nothing, so dark means invisible. The band a role gets is fixed by what the
 *  role is - a comment recedes, a keyword leads - and the palette chooses only
 *  where inside its band the role sits. That way switching the code theme still
 *  changes what the glasses show, and no theme can make its own comments
 *  brighter than its own keywords. */

import type { CodePalette } from '@nib/editor'
import { WHITE } from './panel'

/** Every kind of token the highlighter can name, plus the plain code around
 *  them. The same groups `code-theme.ts` colours, so a fence looks like itself
 *  on the glasses and on the screen. */
export type CodeRole =
  | 'text'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'function'
  | 'type'
  | 'punctuation'
  | 'property'
  | 'inserted'
  | 'deleted'
  | 'invalid'

export type Weight = 'normal' | 'bold'
export type Slant = 'normal' | 'italic'

/** How one role is drawn: a band of grey to sit in, and the two other axes. */
export interface RoleLook {
  /** Dimmest and brightest level the role may take, both inclusive. */
  band: readonly [number, number]
  weight: Weight
  slant: Slant
}

/** Every role's band and emphasis.
 *
 *  The bands do not overlap *within one emphasis*, and that is the whole of why
 *  two roles can never come out looking alike: two roles drawn at the same
 *  brightness are always drawn plain against italic, or plain against bold. Set
 *  out below in the four groups so that the property is visible rather than
 *  asserted, and a role added to a group has an obvious place to go.
 *
 *  Nothing sits below three. The panel lights pixels rather than inking them,
 *  and one or two out of fifteen is not something anybody reads.
 *
 *  A diff is the one place a palette is overruled outright: added and removed
 *  mean the same in every theme, so one is the brightest thing on the line and
 *  the other recedes with the comments. */
export const ROLE_LOOKS: Readonly<Record<CodeRole, RoleLook>> = {
  // Plain.
  deleted: { band: [3, 5], weight: 'normal', slant: 'normal' },
  punctuation: { band: [6, 8], weight: 'normal', slant: 'normal' },
  string: { band: [9, 11], weight: 'normal', slant: 'normal' },
  text: { band: [12, 12], weight: 'normal', slant: 'normal' },
  number: { band: [13, 14], weight: 'normal', slant: 'normal' },
  inserted: { band: [WHITE, WHITE], weight: 'normal', slant: 'normal' },

  // Italic.
  comment: { band: [3, 6], weight: 'normal', slant: 'italic' },
  property: { band: [8, 11], weight: 'normal', slant: 'italic' },
  type: { band: [12, 15], weight: 'normal', slant: 'italic' },

  // Bold.
  function: { band: [9, 13], weight: 'bold', slant: 'normal' },
  keyword: { band: [14, WHITE], weight: 'bold', slant: 'normal' },

  // Bold and italic: the one thing that should look wrong.
  invalid: { band: [WHITE, WHITE], weight: 'bold', slant: 'italic' },
}

/** How a role comes out for one code theme: a level rather than a band. */
export interface RoleGrey {
  level: number
  weight: Weight
  slant: Slant
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i

/** A colour's three channels, 0 to 255, or null when this is not a colour this
 *  understands - `var(--accent)` above all, which only a browser can resolve. */
function channels(colour: string): [number, number, number] | null {
  const hex = HEX.exec(colour.trim())
  if (hex?.[1]) {
    const digits = hex[1]
    const wide = digits.length === 6
    const at = (index: number) => {
      const part = wide ? digits.slice(index * 2, index * 2 + 2) : digits.charAt(index).repeat(2)
      return Number.parseInt(part, 16)
    }
    return [at(0), at(1), at(2)]
  }

  const rgb = RGB.exec(colour.trim())
  if (!rgb) return null

  const read = (at: number) => Math.min(255, Math.max(0, Number(rgb[at])))
  return [read(1), read(2), read(3)]
}

/** Relative luminance, 0 for black and 1 for white, by the sRGB weights. Used
 *  to place a role inside its band, and to turn a picture into greys. */
export function luminance(red: number, green: number, blue: number): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

/** A colour's luminance, or null when the string is not one this can read. */
export function colourLuminance(colour: string): number | null {
  const parts = channels(colour)
  return parts ? luminance(...parts) : null
}

/** A luminance as one of the sixteen levels. */
export function greyOf(brightness: number): number {
  return Math.min(WHITE, Math.max(0, Math.round(brightness * WHITE)))
}

/** Where inside `band` a colour sits. A colour nothing can read - a `var()`,
 *  which is what the palette that follows the theme is made of - lands in the
 *  middle of the band, which is the band's own answer rather than a guess. */
function inBand(band: readonly [number, number], colour: string): number {
  const [low, high] = band
  const brightness = colourLuminance(colour)
  if (brightness === null) return Math.round((low + high) / 2)

  return low + Math.round(brightness * (high - low))
}

/** Every role's look for one code theme. */
export function codeGreys(palette: CodePalette): Readonly<Record<CodeRole, RoleGrey>> {
  // Plain code, a diff's two sides and an invalid token have no palette entry:
  // the first is the note's own ink, and the other three mean the same in every
  // theme. See `code-theme.ts`, which says as much about the diff colours.
  const colours: Record<CodeRole, string> = {
    text: '',
    keyword: palette.keyword,
    string: palette.string,
    number: palette.number,
    comment: palette.comment,
    function: palette.function,
    type: palette.type,
    punctuation: palette.punctuation,
    property: palette.property,
    inserted: '',
    deleted: '',
    invalid: '',
  }

  const out = {} as Record<CodeRole, RoleGrey>
  for (const [role, look] of Object.entries(ROLE_LOOKS) as [CodeRole, RoleLook][]) {
    out[role] = {
      level: inBand(look.band, colours[role]),
      weight: look.weight,
      slant: look.slant,
    }
  }

  return out
}
