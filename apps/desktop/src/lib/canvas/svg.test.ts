import { describe, expect, test } from 'vitest'
import { INK_TOOLS, type InkStroke } from './format'
import { INK_STYLES } from './ink'
import type { Palette } from './paint'
import { inkSvg } from './svg'

const PALETTE: Palette = { '1': '#ff0000', ink: '#111111' }

function stroke(over: Partial<InkStroke> = {}): InkStroke {
  return {
    id: 'a',
    tool: 'pen',
    color: '1',
    size: 4,
    points: [
      { x: 0, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
      { x: 40, y: 10, pressure: 0.6, tiltX: 0, tiltY: 0, t: 8 },
      { x: 80, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 16 },
    ],
    ...over,
  }
}

function alphas(svg: string): number[] {
  return [...svg.matchAll(/fill-opacity="([\d.]+)"/g)].map((one) => Number(one[1]))
}

describe('ink written into a picture', () => {
  test('carries the alpha the stroke was drawn at', () => {
    expect(alphas(inkSvg([stroke({ opacity: 0.25 })], PALETTE))).toEqual([0.25])
  })

  test('carries the pen its own alpha when the stroke never said', () => {
    for (const tool of ['pen', 'pencil', 'highlighter'] as const) {
      expect(alphas(inkSvg([stroke({ tool })], PALETTE)), tool).toEqual([INK_STYLES[tool].opacity])
    }
  })

  test('a highlighter turned right up comes out solid rather than washed', () => {
    expect(alphas(inkSvg([stroke({ tool: 'highlighter', opacity: 1 })], PALETTE))).toEqual([1])
    expect(INK_STYLES.highlighter.opacity).toBeLessThan(1)
  })

  test('is painted in the colour the theme gave that preset', () => {
    expect(inkSvg([stroke()], PALETTE)).toContain('fill="#ff0000"')
  })

  test('is painted as written when the colour is one of its own', () => {
    expect(inkSvg([stroke({ color: '#abcdef' })], PALETTE)).toContain('fill="#abcdef"')
  })

  test('darkens what it crosses only where the pen does', () => {
    expect(inkSvg([stroke({ tool: 'highlighter' })], PALETTE)).toContain('mix-blend-mode:multiply')
    expect(inkSvg([stroke()], PALETTE)).not.toContain('mix-blend-mode')
  })

  test('is one path for each stroke, so a drawing opens as the strokes it was', () => {
    const svg = inkSvg([stroke(), stroke({ id: 'b' }), stroke({ id: 'c' })], PALETTE)
    expect(svg.match(/<path /g)).toHaveLength(3)
  })

  test('leaves out a stroke with nothing in it', () => {
    expect(inkSvg([stroke({ points: [] })], PALETTE)).toBe('')
  })

  test('still draws the dot a pen put down and lifted, whichever pen it was', () => {
    for (const tool of INK_TOOLS) {
      const dot = stroke({
        tool,
        points: [{ x: 0, y: 0, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }],
      })
      const svg = inkSvg([dot], PALETTE)

      expect(svg, tool).toContain('<path ')
      expect(svg, tool).toMatch(/ d="M[^"]+Z"/)
    }
  })
})

describe('a colour a file wrote', () => {
  test('cannot end the attribute it is written into', () => {
    const hostile = '"><script>alert(1)</script><path fill="'
    const svg = inkSvg([stroke({ color: hostile })], PALETTE)

    expect(svg).not.toContain('<script')
    expect(svg.match(/<path /g)).toHaveLength(1)
  })

  test('is read off the palette and never off its prototype', () => {
    expect(inkSvg([stroke({ color: 'toString' })], PALETTE)).toContain('fill="toString"')
  })
})
