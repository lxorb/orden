import { describe, expect, test } from 'vitest'
import { scanNote } from './scan-note'

function linked(lines: number): string {
  const out: string[] = ['# Reading', '']

  for (let line = 0; line < lines; line++) {
    if (line % 4 === 0) out.push(`See [[note-${String(line).padStart(4, '0')}]] on this.`)
    else if (line % 21 === 0) out.push(`## Part ${line / 21}`)
    else out.push(`Line ${line}: the wind was steady and the ink took its time on the page.`)
  }

  return out.join('\n')
}

function looks<T>(run: () => T): { counted: number; got: T } {
  const was = Object.getOwnPropertyDescriptor(String.prototype, 'indexOf')
  if (!was) throw new Error('no indexOf to count')

  const real = was.value as (this: string, needle: string, from?: number) => number
  let counted = 0

  Object.defineProperty(String.prototype, 'indexOf', {
    ...was,
    value(this: string, needle: string, from?: number) {
      if (needle === '\n') counted++
      return real.call(this, needle, from)
    },
  })

  try {
    return { got: run(), counted }
  } finally {
    Object.defineProperty(String.prototype, 'indexOf', was)
  }
}

describe('what reading a note for the index costs', () => {
  test('places a thousand links without a pass down the note for each of them', () => {
    const lines = 4_000
    const { counted, got } = looks(() => scanNote('reading/Long.md', linked(lines)))

    expect(got.links).toHaveLength(1_000)
    expect(counted).toBeLessThan(lines * 8)
  })

  test('costs the same per line whether the lines hold links or not', () => {
    const lines = 4_000
    const plain = linked(lines).replace(/\[\[([^\]]+)\]\]/g, '$1')
    const withLinks = linked(lines)

    const bare = looks(() => scanNote('reading/Plain.md', plain)).counted
    const linky = looks(() => scanNote('reading/Long.md', withLinks)).counted

    expect(linky).toBeLessThan(bare * 3)
  })

  test('says which line each link sits on', () => {
    const note = scanNote(
      'ideas/Plan.md',
      ['# Plan', '', 'See [[One]].', '', 'And [[Two]] as well.', '', '[three](Three.md)'].join(
        '\n',
      ),
    )

    expect(note.links.map((link) => [link.target, link.line])).toEqual([
      ['One', 2],
      ['Two', 4],
      ['Three.md', 6],
    ])
  })

  test('places links below a fenced block on the lines they are really on', () => {
    const note = scanNote(
      'ideas/Fenced.md',
      ['# Plan', '', '```', 'See [[Nothing]].', '```', '', 'See [[One]].'].join('\n'),
    )

    expect(note.links.map((link) => [link.target, link.line])).toEqual([['One', 6]])
  })
})
