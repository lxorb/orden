/** A page's pixels in the bytes the glasses want.
 *
 *  The panel is four bits a pixel, so two pixels share a byte. `updateImageRawData`
 *  takes those bytes with no width, height or stride beside them - the container
 *  it is addressed to says how wide the rows are - which leaves exactly one
 *  thing to get right and no way to be told when it is wrong. The layout this
 *  writes, and which the simulator was checked against:
 *
 *    - rows top to bottom, pixels left to right, no padding between rows;
 *    - two pixels per byte, the left one in the high nibble;
 *    - a level of 0 is a pixel that is off, which on these glasses is nothing at
 *      all rather than black, and 15 is full brightness.
 *
 *  A container whose width is odd would need a padding rule and there is none
 *  published, so `packGray4` refuses one rather than guess. Every container this
 *  package asks for is 288 wide. */

import { GREY_LEVELS, WHITE } from './panel'

/** One byte per pixel, each 0 to 15. What the rasteriser produces and what the
 *  packer consumes; a plain buffer rather than a class because it is handed
 *  between a canvas, a hash and a radio. */
export interface Tile {
  width: number
  height: number
  /** `width * height` levels, row by row. */
  levels: Uint8Array
}

/** The bytes for one tile. Throws on a tile that does not add up, because a
 *  short buffer would be tiled across the container by the firmware and the
 *  reader would see the top of the page repeated down the glass. */
export function packGray4(tile: Tile): Uint8Array {
  const { width, height, levels } = tile
  if (width <= 0 || height <= 0) throw new Error('a tile has no size')
  if (width % 2 !== 0) throw new Error(`a tile ${width} wide has no published padding rule`)
  if (levels.length !== width * height) {
    throw new Error(
      `a ${width}x${height} tile wants ${width * height} levels, got ${levels.length}`,
    )
  }

  const out = new Uint8Array((width * height) / 2)
  for (let at = 0, byte = 0; at < levels.length; at += 2, byte++) {
    const left = (levels[at] ?? 0) & 0x0f
    const right = (levels[at + 1] ?? 0) & 0x0f
    out[byte] = (left << 4) | right
  }

  return out
}

/** The levels back out of the bytes. Only the round trip test and the simulator
 *  check ever need this, and they are the reason the layout above is a fact
 *  rather than a hope. */
export function unpackGray4(bytes: Uint8Array, width: number, height: number): Tile {
  if (bytes.length * 2 !== width * height) {
    throw new Error(`${bytes.length} bytes are not a ${width}x${height} tile`)
  }

  const levels = new Uint8Array(width * height)
  for (let byte = 0; byte < bytes.length; byte++) {
    const both = bytes[byte] ?? 0
    levels[byte * 2] = (both >> 4) & 0x0f
    levels[byte * 2 + 1] = both & 0x0f
  }

  return { width, height, levels }
}

/** Two pixels of nothing. Sent to a container that should show nothing: the
 *  firmware tiles data that is smaller than its container, so two dark pixels
 *  fill it, and it costs one packet rather than the container's own size. */
export function blankGray4(): Uint8Array {
  return new Uint8Array([0])
}

/** A channel from 0 to 255 as one of the sixteen levels. */
export function quantise(value: number): number {
  return Math.min(WHITE, Math.max(0, Math.round((value / 255) * WHITE)))
}

/** The 4x4 ordered matrix, in sixteenths. Ordered rather than error-diffused on
 *  purpose: the display docs warn that diffusing error over a panel this coarse
 *  comes out as moving speckle, and an ordered pattern at four bits is a faint
 *  regular texture that reads as a tone. */
const BAYER: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** A picture's greys as levels, with the banding broken up.
 *
 *  Only pictures go through this. Text is drawn straight and quantised straight:
 *  a dither over a glyph's edge is what turns small type to mush. */
export function ditherToLevels(grey: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  const step = 255 / WHITE

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x
      const threshold = ((BAYER[(y % 4) * 4 + (x % 4)] ?? 0) + 0.5) / GREY_LEVELS - 0.5
      out[at] = quantise((grey[at] ?? 0) + threshold * step)
    }
  }

  return out
}
