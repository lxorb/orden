import type { Scheme } from '@orden/contracts'
import type { Rgb, Span } from '../../../ui-controls/src/api'
import { isNumber, isRecord, isString, parsed, storedText } from '../../../platform/src/api'

export const WALLPAPER_THEME = 'wallpaper'
export const WALLPAPER_KEY = 'orden:wallpaper'
export const DARK_KEY = 'orden:wallpaper-dark'

interface Side {
  floor: number
  ground: string
}

export interface Held {
  picture: string
  blur: number
  tone?: string
  span?: Span
  mean?: string
  size?: [number, number]
  focus: [number, number]
  dark?: Side
  light?: Side
}

const PICTURE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/
const COLOUR = /^#[0-9a-f]{6}$/i

function sideOf(said: unknown): Side | null {
  if (!isRecord(said) || !isNumber(said.floor) || !isString(said.ground)) return null
  if (said.floor < 0 || said.floor > 1 || !COLOUR.test(said.ground)) return null
  return { floor: said.floor, ground: said.ground }
}

function rgb(said: unknown): Rgb | null {
  if (!Array.isArray(said) || said.length !== 3) return null
  return said.every((one) => isNumber(one) && one >= 0 && one <= 255)
    ? (said as unknown as Rgb)
    : null
}

function spanOf(said: unknown): Span | undefined {
  if (!isRecord(said)) return undefined
  const least = rgb(said.least)
  const most = rgb(said.most)
  return least && most ? { least, most } : undefined
}

function pairOf(said: unknown, low: number, high: number): [number, number] | null {
  if (!Array.isArray(said) || said.length !== 2) return null
  const [x, y] = said as unknown[]
  if (!isNumber(x) || !isNumber(y)) return null
  return [Math.min(high, Math.max(low, x)), Math.min(high, Math.max(low, y))]
}

const read = new Map<string, { text: string | null; held: Held | null }>()

function heldIn(text: string | null): Held | null {
  const said = parsed(text)
  if (!isRecord(said) || !isString(said.picture) || !isNumber(said.blur)) return null
  if (!PICTURE.test(said.picture)) return null

  const dark = sideOf(said.dark)
  const light = sideOf(said.light)
  const span = spanOf(said.span)
  if (!span && (!dark || !light)) return null

  const size = pairOf(said.size, 1, 1 << 15)
  return {
    picture: said.picture,
    blur: said.blur,
    ...(isString(said.tone) ? { tone: said.tone } : {}),
    ...(span ? { span } : {}),
    ...(isString(said.mean) && COLOUR.test(said.mean) ? { mean: said.mean } : {}),
    ...(size ? { size } : {}),
    focus: pairOf(said.focus, 0, 1) ?? [0.5, 0.5],
    ...(dark && light ? { dark, light } : {}),
  }
}

function heldAt(key: string): Held | null {
  const text = storedText(key)
  const last = read.get(key)
  if (last?.text === text) return last.held
  const held = heldIn(text)
  read.set(key, { text, held })
  return held
}

export function heldWallpaper(): Held | null {
  return heldAt(WALLPAPER_KEY)
}

export function heldDark(): Held | null {
  return heldAt(DARK_KEY)
}

export function heldFor(scheme: Scheme): Held | null {
  return (scheme === 'dark' ? heldDark() : null) ?? heldWallpaper()
}
