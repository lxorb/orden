import { describe, expect, test } from 'vitest'
import { DEFAULT_PAGE_SETUP } from '@orden/contracts'
import { paperTwips } from '../../files-out/src/api'
import { documentOf } from './document'
import { toRtf } from './rtf'

const PAPER = paperTwips(DEFAULT_PAGE_SETUP, 'Sizes', '2026-11-18')

function be32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
}

function pngOf(width: number, height: number): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const type = [0x49, 0x48, 0x44, 0x52]
  return new Uint8Array([
    ...signature,
    ...be32(13),
    ...type,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ])
}

const SHOT = { src: 'shot.png', name: 'shot.png', mime: 'image/png', bytes: pngOf(800, 400) }

function goalOf(note: string): string | undefined {
  const rtf = toRtf(documentOf(note, 'Sizes.md'), [SHOT], PAPER)
  return /\\picwgoal(\d+)/.exec(rtf)?.[1]
}

describe('a picture the writer sized, in Word and RTF exports', () => {
  test('a picture resized to a quarter in the editor keeps that size', () => {
    expect(goalOf('<img src="shot.png" alt="" style="zoom:25%;" />\n')).toBe(String(200 * 15))
  })

  test('a picture written with a width keeps that width', () => {
    expect(goalOf('![shot|300](shot.png)\n')).toBe(String(300 * 15))
  })

  test('an img tag written with a width keeps that width', () => {
    expect(goalOf('<img src="shot.png" width="300">\n')).toBe(String(300 * 15))
  })
})
