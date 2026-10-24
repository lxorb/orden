import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { edits } from './diff'
import type { Edit } from './merge3'

function applied(old: string, list: readonly Edit[]): string {
  let out = ''
  let at = 0
  for (const edit of list) {
    expect(edit.from).toBeGreaterThanOrEqual(at)
    out += old.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return out + old.slice(at)
}

const line = fc
  .tuple(
    fc.constantFrom('- [ ] ', '- ', '', '# '),
    fc.array(fc.constantFrom('alpha', 'beta', 'milk', 'rent', 'a', 'x', 'é', '😀', ''), {
      maxLength: 4,
    }),
  )
  .map(([mark, words]) => `${mark}${words.join(' ')}\n`)
const text = fc.array(line, { maxLength: 8 }).map((lines) => lines.join(''))

describe('edits', () => {
  test('property: either reading, applied in order, makes the new text', () => {
    fc.assert(
      fc.property(text, text, (old, now) => {
        expect(applied(old, edits(old, now, 'semantic'))).toBe(now)
        expect(applied(old, edits(old, now, 'operations'))).toBe(now)
      }),
      { numRuns: 1000 },
    )
  })

  test('a line added above another is added between lines, not inside one', () => {
    expect(edits('- call Ann\n', '- L call Ann z\n- call Ann\n', 'semantic')).toEqual([
      { from: 0, to: 0, insert: '- L call Ann z\n' },
    ])
  })
})
