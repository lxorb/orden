import type { Rgb, Span } from '../../../legibility'

export const LARGEST = 480
const SMALLEST = 64

export function sideFor(blur: number, screen: number): number {
  const wanted = Math.round((2 * screen) / Math.max(1, blur))
  return Math.min(LARGEST, Math.max(SMALLEST, wanted))
}

export function sharpBelow(screen: number): number {
  return (2 * screen) / LARGEST
}

export function sharpSide(blur: number, screen: number, most: number): number {
  if (blur <= 0) return most
  return Math.min(most, Math.max(LARGEST, Math.round((2 * screen) / blur)))
}

export interface Toning {
  saturation: number
  tint: number
  colour: Rgb
}

const GREY = [0.213, 0.715, 0.072] as const

export function toned(pixels: Uint8ClampedArray, toning: Toning): void {
  const { saturation, tint, colour } = toning
  if (saturation === 1 && tint <= 0) return

  const [tr, tg, tb] = colour
  const keep = 1 - tint
  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at] ?? 0
    const g = pixels[at + 1] ?? 0
    const b = pixels[at + 2] ?? 0
    const grey = GREY[0] * r + GREY[1] * g + GREY[2] * b
    pixels[at] = (grey + (r - grey) * saturation) * keep + tr * tint
    pixels[at + 1] = (grey + (g - grey) * saturation) * keep + tg * tint
    pixels[at + 2] = (grey + (b - grey) * saturation) * keep + tb * tint
  }
}

export function fitted(width: number, height: number, side: number): [number, number] {
  const scale = Math.min(1, side / Math.max(width, height, 1))
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

export function boxesFor(sigma: number): [number, number, number] {
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1)
  let lower = Math.floor(ideal)
  if (lower % 2 === 0) lower--
  const upper = lower + 2
  const many = Math.round(
    (12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4),
  )

  return [0, 1, 2].map((at) => (at < many ? lower : upper)) as [number, number, number]
}

function box(
  from: Uint8ClampedArray,
  to: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  columns: boolean,
): void {
  const lines = columns ? width : height
  const length = columns ? height : width
  const stride = columns ? width * 4 : 4
  const span = radius * 2 + 1

  for (let line = 0; line < lines; line++) {
    const start = columns ? line * 4 : line * width * 4
    const at = (index: number) => start + Math.min(length - 1, Math.max(0, index)) * stride

    for (let channel = 0; channel < 3; channel++) {
      let sum = 0
      for (let index = -radius; index <= radius; index++) sum += from[at(index) + channel] ?? 0

      for (let index = 0; index < length; index++) {
        to[start + index * stride + channel] = sum / span
        sum +=
          (from[at(index + radius + 1) + channel] ?? 0) - (from[at(index - radius) + channel] ?? 0)
      }
    }

    for (let index = 0; index < length; index++) to[start + index * stride + 3] = 255
  }
}

export function blurred(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  sigma: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = Uint8ClampedArray.from(pixels)
  if (sigma <= 0) return out

  const scratch = new Uint8ClampedArray(pixels.length)
  for (const size of boxesFor(sigma)) {
    const radius = (size - 1) / 2
    box(out, scratch, width, height, radius, false)
    box(scratch, out, width, height, radius, true)
  }

  return out
}

export function measured(pixels: Uint8ClampedArray): Span & { mean: Rgb } {
  const least: [number, number, number] = [255, 255, 255]
  const most: [number, number, number] = [0, 0, 0]
  const sum: [number, number, number] = [0, 0, 0]
  const count = Math.max(1, Math.floor(pixels.length / 4))

  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at] ?? 0
    const g = pixels[at + 1] ?? 0
    const b = pixels[at + 2] ?? 0
    if (r < least[0]) least[0] = r
    if (g < least[1]) least[1] = g
    if (b < least[2]) least[2] = b
    if (r > most[0]) most[0] = r
    if (g > most[1]) most[1] = g
    if (b > most[2]) most[2] = b
    sum[0] += r
    sum[1] += g
    sum[2] += b
  }

  return { least, most, mean: [sum[0] / count, sum[1] / count, sum[2] / count] }
}
