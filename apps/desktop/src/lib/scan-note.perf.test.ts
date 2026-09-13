import { describe, expect, test } from 'vitest'
import { scanNote } from './scan-note'

/** What reading one note for the index costs, as the note gets longer.
 *
 *  Counted rather than timed, for the reason match.perf.test.ts gives beside its
 *  own counts: the suite runs several files over whatever cores are left, and a
 *  walk that was descheduled halfway through says nothing about the walk.
 *
 *  The count is how many times the scan looks for a newline, which is how a pass
 *  down a note is taken here - see `lines` in @nib/markdown/links, walked with
 *  indexOf rather than split so a long note is not copied into an array. Each pass
 *  down a note is one look per line of it, so the count says how many passes the
 *  scan took: a handful, whatever the note holds, or one per link.
 *
 *  Which is the whole question. Working out which line a link sits on by counting
 *  the newlines before it is one pass per link, and a note with a link every few
 *  lines has as many of those as it has links: four thousand lines with a thousand
 *  links in them was two million looks, over four hundred megabytes of a note that
 *  is four hundred kilobytes. The pass that finds the links already knows which
 *  line each one is on, because it is walking the note line by line to find them,
 *  and a link that carries its own line number costs nothing to place.
 *
 *  The shape is what matters here and not the absolute figure, so the count is
 *  held against the note rather than against a number: a scan is worth a few looks
 *  per line, and anything worth a look per line per link is the quadratic one
 *  back. On the machine this was written on, before and after: 2,012,000 looks and
 *  17,000, for the same note and the same answer. */

/** A note with a link every fourth line, which is what a note somebody keeps their
 *  reading in looks like. Long on purpose: the difference between one pass and one
 *  per link only shows where there are enough lines for a pass to cost something. */
function linked(lines: number): string {
  const out: string[] = ['# Reading', '']

  for (let line = 0; line < lines; line++) {
    if (line % 4 === 0) out.push(`See [[note-${String(line).padStart(4, '0')}]] on this.`)
    else if (line % 21 === 0) out.push(`## Part ${line / 21}`)
    else out.push(`Line ${line}: the wind was steady and the ink took its time on the page.`)
  }

  return out.join('\n')
}

/** Every look for a newline while `run` goes, counted.
 *
 *  On the string prototype, because the count wanted is of the looks the scan
 *  actually takes and those are spread over four modules that each walk a note
 *  their own way. A counter inside one of them would count that one; this counts
 *  the scan. Put back afterwards whatever happens, so a failure here does not
 *  leave a patched prototype behind for the rest of the file. */
function looks<T>(run: () => T): { counted: number; got: T } {
  // Taken and put back as a property rather than as a method, so what is held here
  // is a descriptor and not a function separated from the object it belongs to.
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
    // A handful of passes down the note, and one look per link for the words it is
    // read in. A pass per link would be a thousand times this.
    expect(counted).toBeLessThan(lines * 8)
  })

  test('costs the same per line whether the lines hold links or not', () => {
    const lines = 4_000
    const plain = linked(lines).replace(/\[\[([^\]]+)\]\]/g, '$1')
    const withLinks = linked(lines)

    const bare = looks(() => scanNote('reading/Plain.md', plain)).counted
    const linky = looks(() => scanNote('reading/Long.md', withLinks)).counted

    // The links cost their own look each and nothing more, so the two are within a
    // small multiple. Placing each link by counting the newlines before it made the
    // linked note hundreds of times the plain one.
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
