import { afterEach, describe, expect, test } from 'vitest'
import { forgetParsed, parseAhead, takeParsed, writeCanvas } from './format'
import { emptyCanvas, type InkStroke } from '@orden/markdown/canvas'

function plane(count: number): string {
  const ink: InkStroke[] = []
  for (let one = 0; one < count; one++) {
    const points = []
    for (let step = 0; step < 10; step++) {
      points.push({
        x: one * 4 + step,
        y: step * 2,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: step * 8,
      })
    }
    ink.push({ id: `s${one}`, tool: 'pen', color: 'ink', size: 3, points })
  }

  return writeCanvas({ ...emptyCanvas(), ink })
}

function parses(run: () => void): number {
  const real = JSON.parse
  let counted = 0

  JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]): unknown => {
    counted++
    return real(text, reviver) as unknown
  }) as typeof JSON.parse

  try {
    run()
  } finally {
    JSON.parse = real
  }

  return counted
}

afterEach(() => {
  forgetParsed()
})

describe('a plane read ahead of the surface that shows it', () => {
  test('is handed over rather than read again', () => {
    const text = plane(200)

    expect(parses(() => parseAhead(text))).toBe(1)

    let taken = null
    expect(parses(() => (taken = takeParsed(text)))).toBe(0)
    expect(taken).not.toBeNull()
  })

  test('once, so two surfaces on one file do not share a plane', () => {
    const text = plane(20)
    parseAhead(text)

    expect(takeParsed(text)).not.toBeNull()
    expect(takeParsed(text)).toBeNull()
  })

  test('and only for the plane it was read for', () => {
    parseAhead(plane(20))

    expect(takeParsed(plane(21))).toBeNull()
  })

  test('and is let go of where the tab never opened', () => {
    parseAhead(plane(20))
    forgetParsed()

    expect(takeParsed(plane(20))).toBeNull()
  })

  test('so opening a plane reads it once between them, not twice', () => {
    const text = plane(200)

    const both = parses(() => {
      parseAhead(text)
      const held = takeParsed(text)
      expect(held).not.toBeNull()
    })

    expect(both).toBe(1)
  })

  test('and is refused for text that is not a plane, with nothing held for it (#534)', () => {
    parseAhead(plane(20))

    expect(parseAhead('{"nodes":[],}')).toBe(false)
    expect(takeParsed(plane(20))).toBeNull()
  })
})
