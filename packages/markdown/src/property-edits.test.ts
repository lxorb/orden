import { describe, expect, test } from 'vitest'
import { readProperties } from './properties'
import {
  addProperty,
  propertyNamed,
  removeProperty,
  renameProperty,
  withItem,
  withoutItem,
  writeList,
  writeProperty,
  writtenList,
} from './property-edits'

/** What a control in a property row writes back, which has to be plain front matter:
 *  a note edited through the rows and a note typed by hand are the same file, and
 *  nothing written here may be a shape `readProperties` cannot read back. */

const applied = (source: string, edit: { from: number; to: number; insert: string } | null) =>
  edit === null ? source : source.slice(0, edit.from) + edit.insert + source.slice(edit.to)

const NOTE = '---\ntitle: A note\ndone: false\ncount: 3\ntags: [one, two]\n---\n\nWords.\n'

describe('a value typed into a row', () => {
  test('replaces the value and leaves the rest of the block alone', () => {
    expect(applied(NOTE, writeProperty(NOTE, 'title', 'Another'))).toBe(
      '---\ntitle: Another\ndone: false\ncount: 3\ntags: [one, two]\n---\n\nWords.\n',
    )
  })

  /** Two rows, and each one's field writes its own line. */
  test('changes the key it names where another is spelled in another case', () => {
    const both = '---\nTitle: a\ntitle: b\n---\n'
    expect(applied(both, writeProperty(both, 'title', 'c'))).toBe('---\nTitle: a\ntitle: c\n---\n')
    expect(applied(both, writeProperty(both, 'Title', null))).toBe('---\ntitle: b\n---\n')
  })

  test('is written as YAML says it, so a word that reads as something else is quoted', () => {
    const written = applied(NOTE, writeProperty(NOTE, 'title', 'true'))

    expect(written).toContain("title: 'true'")
  })

  test('cannot end the block it is written into', () => {
    const written = applied(NOTE, writeProperty(NOTE, 'title', 'one\n---\nnot the note'))

    // Two fence lines, which is what a block has: a value that could close the
    // block would put the rest of the note's metadata into the note.
    expect(written.split('\n').filter((line) => line.trim() === '---')).toHaveLength(2)
    expect(readProperties(written)).not.toBeNull()
    expect(written.endsWith('Words.\n')).toBe(true)
  })

  test('takes the key away when there is nothing in the field', () => {
    expect(applied(NOTE, writeProperty(NOTE, 'title', null))).not.toContain('title:')
  })

  test('writes nothing at all when the note already says it', () => {
    expect(writeProperty(NOTE, 'title', 'A note')).toBeNull()
  })

  test('over a list written under its key, leaves none of the items behind', () => {
    const listed = '---\ntitle: a\ntags:\n  - x\n  - y\n---\nbody\n'
    const written = applied(listed, writeProperty(listed, 'tags', 'z'))
    expect(written).toBe('---\ntitle: a\ntags: z\n---\nbody\n')
    expect(readProperties(applied(listed, writeProperty(listed, 'tags', null)))).toHaveLength(1)
  })
})

describe('a checkbox and a number', () => {
  test('a quoted value edited in its row keeps its quotes', () => {
    const note = '---\nzip: \'007\'\nflag: "true"\n---\n'
    const rows = readProperties(note) ?? []
    const zip = rows.find((one) => one.key === 'zip')
    const flag = rows.find((one) => one.key === 'flag')
    expect(applied(note, writeProperty(note, 'zip', '0071', zip?.kind))).toContain("zip: '0071'")
    expect(applied(note, writeProperty(note, 'flag', 'false', flag?.kind))).toContain(
      "flag: 'false'",
    )
  })

  test('are the words YAML reads as a boolean and a number', () => {
    const ticked = applied(NOTE, writeProperty(NOTE, 'done', 'true', 'checkbox'))
    expect(ticked).toContain('done: true')
    expect(readProperties(ticked)?.find((one) => one.key === 'done')?.kind).toBe('checkbox')

    const counted = applied(NOTE, writeProperty(NOTE, 'count', '42', 'number'))
    expect(counted).toContain('count: 42')
    expect(readProperties(counted)?.find((one) => one.key === 'count')?.kind).toBe('number')
  })
})

describe('a list', () => {
  test('is written as the flow sequence every reader of one reads', () => {
    expect(writtenList(['one', 'two'])).toBe('[one, two]')
    expect(writtenList([])).toBe('[]')
    expect(writtenList(['one, two'])).toBe("['one, two']")
  })

  test('replaces the key wherever the note put it', () => {
    expect(applied(NOTE, writeList(NOTE, 'tags', ['one', 'two', 'three']))).toContain(
      'tags: [one, two, three]',
    )
  })

  test('comes back as one line however many lines it was written over', () => {
    const lines = '---\ntags:\n  - one\n  - two\n  - three\ntitle: A note\n---\n\nWords.\n'
    const written = applied(lines, writeList(lines, 'tags', ['one']))

    expect(written).toBe('---\ntags: [one]\ntitle: A note\n---\n\nWords.\n')
    expect(readProperties(written)?.find((one) => one.key === 'tags')?.items).toEqual(['one'])
  })

  test('keeps a file’s own line endings', () => {
    const note = '---\r\ntitle: a\r\ntags:\r\n  - x\r\n  - y\r\n---\r\nbody\r\n'
    expect(applied(note, writeProperty(note, 'title', 'b'))).toBe(
      '---\r\ntitle: b\r\ntags:\r\n  - x\r\n  - y\r\n---\r\nbody\r\n',
    )
    expect(applied(note, writeList(note, 'tags', ['z']))).toBe(
      '---\r\ntitle: a\r\ntags: [z]\r\n---\r\nbody\r\n',
    )
  })

  test('is appended like any other key where the block does not hold it yet', () => {
    const written = applied(NOTE, writeList(NOTE, 'aliases', ['other']))

    expect(written).toContain('aliases: [other]')
    expect(readProperties(written)?.map((one) => one.key)).toEqual([
      'title',
      'done',
      'count',
      'tags',
      'aliases',
    ])
  })

  test('a chip added is on the end, and the same chip twice says nothing twice', () => {
    const tags = readProperties(NOTE)?.find((one) => one.key === 'tags')
    expect(tags).toBeDefined()
    // Asserted on the line above.
    expect(writtenList(withItem(tags!, 'three') ?? [])).toBe('[one, two, three]')
    expect(withItem(tags!, 'one')).toBeNull()
    expect(withItem(tags!, '  ')).toBeNull()
  })

  test('a chip taken off is gone, and one that was not there changes nothing', () => {
    const tags = readProperties(NOTE)?.find((one) => one.key === 'tags')
    expect(tags).toBeDefined()
    // Asserted on the line above.
    expect(writtenList(withoutItem(tags!, 'one') ?? [])).toBe('[two]')
    expect(withoutItem(tags!, 'three')).toBeNull()
  })

  test('a chip holding a comma stays one chip through every edit after it', () => {
    // The rows read `["a, b", c]` as three chips once, and the next chip taken off
    // wrote the three back: the note lost the value it had been given.
    const quoted = '---\ntags: ["a, b", c]\n---\n\nWords.\n'
    const tags = readProperties(quoted)?.find((one) => one.key === 'tags')
    expect(tags?.items).toEqual(['a, b', 'c'])

    // Asserted on the line above.
    const written = applied(quoted, writeList(quoted, 'tags', withoutItem(tags!, 'c') ?? []))
    expect(written).toBe('---\ntags: ["a, b"]\n---\n\nWords.\n')
    expect(readProperties(written)?.find((one) => one.key === 'tags')?.items).toEqual(['a, b'])

    const again = applied(written, writeList(written, 'tags', ['a, b', "It's, here"]))
    expect(readProperties(again)?.find((one) => one.key === 'tags')?.items).toEqual([
      'a, b',
      "It's, here",
    ])
  })

  test('a chip taken off a list of numbers leaves the others numbers', () => {
    const note = '---\nscores: [1, 2, 10]\n---\n'
    const scores = readProperties(note)?.find((one) => one.key === 'scores')
    expect(scores).toBeDefined()
    // Asserted on the line above.
    const written = applied(note, writeList(note, 'scores', withoutItem(scores!, '2') ?? []))
    expect(written).toBe('---\nscores: [1, 10]\n---\n')
  })

  test('each item keeps its type: bare where it is a number, a yes or nothing', () => {
    expect(writtenList([1, 2.5, -3, true, false, null, 'one'])).toBe(
      '[1, 2.5, -3, true, false, null, one]',
    )
    // Words that YAML would read as something else stay words.
    expect(writtenList(['1', 'true', 'null', '~', ''])).toBe("['1', 'true', 'null', '~', '']")
  })

  test('a chip off a mixed list leaves quoted items quoted and plain ones plain', () => {
    const note = "---\nmixed: [1, '2', true, 'false', null, x, y]\n---\n"
    const mixed = readProperties(note)?.find((one) => one.key === 'mixed')
    expect(mixed).toBeDefined()
    // Asserted on the line above.
    const written = applied(note, writeList(note, 'mixed', withoutItem(mixed!, 'y') ?? []))
    expect(written).toBe("---\nmixed: [1, '2', true, 'false', null, x]\n---\n")
  })

  test('a chip added to a list keeps the items before it as they were', () => {
    const note = '---\nscores:\n  - 1\n  - true\n---\n'
    const scores = readProperties(note)?.find((one) => one.key === 'scores')
    expect(scores).toBeDefined()
    // Asserted on the line above.
    const written = applied(note, writeList(note, 'scores', withItem(scores!, 'more') ?? []))
    expect(written).toBe('---\nscores: [1, true, more]\n---\n')
  })

  test('a chip typed into a list is written the way it would be typed bare', () => {
    const note = '---\nscores: [1, 10]\n---\n'
    const scores = readProperties(note)?.find((one) => one.key === 'scores')
    expect(scores).toBeDefined()
    // Asserted on the line above.
    const added = (typed: string) =>
      applied(note, writeList(note, 'scores', withItem(scores!, typed) ?? []))

    expect(added('3')).toBe('---\nscores: [1, 10, 3]\n---\n')
    expect(added('-2.5')).toBe('---\nscores: [1, 10, -2.5]\n---\n')
    expect(added('true')).toBe('---\nscores: [1, 10, true]\n---\n')
    // Bare, each of these would read back as something other than what was typed.
    expect(added('007')).toBe("---\nscores: [1, 10, '007']\n---\n")
    expect(added('1e3')).toBe("---\nscores: [1, 10, '1e3']\n---\n")
    expect(added('yes')).toBe("---\nscores: [1, 10, 'yes']\n---\n")
    expect(added('null')).toBe("---\nscores: [1, 10, 'null']\n---\n")
    expect(added('True')).toBe("---\nscores: [1, 10, 'True']\n---\n")
    expect(added('a: b')).toBe("---\nscores: [1, 10, 'a: b']\n---\n")
    expect(added('#x')).toBe("---\nscores: [1, 10, '#x']\n---\n")
    expect(added('more')).toBe('---\nscores: [1, 10, more]\n---\n')
  })

  test('a chip taken off leaves every other member exactly as it was written', () => {
    const note = '---\nids: [1234567890123456789, 5, 1.10, 2.0, 007, -0]\n---\n'
    const ids = readProperties(note)?.find((one) => one.key === 'ids')
    expect(ids).toBeDefined()
    // Asserted on the line above.
    const written = applied(note, writeList(note, 'ids', withoutItem(ids!, '5') ?? []))
    expect(written).toBe('---\nids: [1234567890123456789, 1.10, 2.0, 007, -0]\n---\n')

    const quoted = `---\ntags: ["a", 'b', c, "it's"]\n---\n`
    const tags = readProperties(quoted)?.find((one) => one.key === 'tags')
    expect(tags).toBeDefined()
    // Asserted on the line above.
    expect(applied(quoted, writeList(quoted, 'tags', withoutItem(tags!, 'c') ?? []))).toBe(
      `---\ntags: ["a", 'b', "it's"]\n---\n`,
    )
  })

  test('a chip added to a block list keeps its members as written, in a flow list', () => {
    const note = "---\nids:\n  - 007\n  - 1.10\n  - 'x'\n  - a, b\n---\n"
    const ids = readProperties(note)?.find((one) => one.key === 'ids')
    expect(ids).toBeDefined()
    // Asserted on the line above. A plain member holding a comma is one member in a
    // block list and two in a flow one, so that one alone is quoted.
    const written = applied(note, writeList(note, 'ids', withItem(ids!, '3') ?? []))
    expect(written).toBe("---\nids: [007, 1.10, 'x', 'a, b', 3]\n---\n")
    expect(readProperties(written)?.find((one) => one.key === 'ids')?.items).toEqual([
      '007',
      '1.10',
      'x',
      'a, b',
      '3',
    ])
  })

  test('a block list whose members are not flow members is still written as YAML', () => {
    const added = (note: string) => {
      const ids = readProperties(note)?.find((one) => one.key === 'ids')
      expect(ids).toBeDefined()
      // Asserted on the line above.
      return applied(note, writeList(note, 'ids', withItem(ids!, 'z') ?? []))
    }
    // An empty member is nothing, which a flow list says as `null`, not as `[, b]`.
    expect(added('---\nids:\n  - a\n  -\n  - b\n---\n')).toBe('---\nids: [a, null, b, z]\n---\n')
    // A comment would close a flow list early, and a list in a list would be words; a
    // list holding either stays a block list, each member as it was.
    expect(added('---\nids:\n  - a\n  - e # note\n---\n')).toBe(
      '---\nids:\n  - a\n  - e # note\n  - z\n---\n',
    )
    expect(added('---\nids:\n- - x\n- b\n---\n')).toBe('---\nids:\n  - - x\n  - b\n  - z\n---\n')
  })

  test('the last chip off leaves the key with an empty list rather than no key', () => {
    const written = applied(NOTE, writeList(NOTE, 'tags', []))

    expect(written).toContain('tags: []')
    expect(readProperties(written)?.find((one) => one.key === 'tags')?.items).toEqual([])
  })
})

describe('a key renamed from the side panel', () => {
  test('changes the name and nothing else, byte for byte', () => {
    const edit = renameProperty(NOTE, 'done', 'finished')

    expect(edit).toEqual({
      from: NOTE.indexOf('done'),
      to: NOTE.indexOf('done') + 4,
      insert: 'finished',
    })
    expect(applied(NOTE, edit)).toBe(NOTE.replace('done:', 'finished:'))
  })

  test('takes any name front matter reads back as a key', () => {
    for (const name of ['priorität', 'due date', 'Size (cm)', '💰'])
      expect(applied(NOTE, renameProperty(NOTE, 'done', name))).toBe(
        NOTE.replace('done:', `${name}:`),
      )
  })

  test('refuses a name that is not a key, the same name, and one the block already has', () => {
    expect(renameProperty(NOTE, 'done', 'two: words')).toBeNull()
    expect(renameProperty(NOTE, 'done', '#done')).toBeNull()
    expect(renameProperty(NOTE, 'done', '')).toBeNull()
    expect(renameProperty(NOTE, 'done', 'done')).toBeNull()
    expect(renameProperty(NOTE, 'done', 'Title')).toBeNull()
    expect(renameProperty(NOTE, 'missing', 'other')).toBeNull()
  })
})

describe('a key added from the side panel', () => {
  test('is written with nothing after it, in a block or in a new one', () => {
    expect(applied(NOTE, addProperty(NOTE, ' status '))).toBe(
      NOTE.replace('---\n\n', "status: ''\n---\n\n"),
    )
    expect(applied('Words.\n', addProperty('Words.\n', 'status'))).toBe(
      "---\nstatus: ''\n---\nWords.\n",
    )
  })

  /** Writing it anyway was setting the key the note already had to nothing: its list,
   *  or `Status: open` reached through the key in another case. */
  test('refuses a name the block already has, in any case, and an empty one', () => {
    const held = '---\ntags:\n  - a\n  - b\nStatus: open\n---\nWords.\n'

    expect(addProperty(held, 'tags')).toBeNull()
    expect(addProperty(held, 'status')).toBeNull()
    expect(addProperty(held, '  ')).toBeNull()
    expect(propertyNamed(held, ' STATUS ')?.key).toBe('Status')
    expect(propertyNamed(held, 'due')).toBeNull()
  })

  /** A name the block cannot read back as a key: `a: b` wrote `a: b: ''`, which no
   *  reader takes as YAML, and the rest left a line that sent the panel to source. */
  test('refuses a name no reader could take back as a key', () => {
    for (const name of ['a: b', '- x', '#x', '[x]', 'k #c']) {
      expect(addProperty(NOTE, name), name).toBeNull()
    }
  })
})

describe('a key taken away from the side panel', () => {
  test('takes its line and leaves every other line as it was', () => {
    expect(applied(NOTE, removeProperty(NOTE, 'count'))).toBe(NOTE.replace('count: 3\n', ''))
  })

  test('takes a list written over several lines with it', () => {
    const note = '---\ntitle: A\ntags:\n  - one\n  - two\ndone: true\n---\nWords.\n'

    expect(applied(note, removeProperty(note, 'tags'))).toBe(
      '---\ntitle: A\ndone: true\n---\nWords.\n',
    )
  })

  test('takes the fences too when it was the last key, and the blank line under them', () => {
    expect(
      applied(
        '---\ntitle: A\n---\n\nWords.\n',
        removeProperty('---\ntitle: A\n---\n\nWords.\n', 'title'),
      ),
    ).toBe('Words.\n')
  })

  test('keeps a file’s own line endings', () => {
    const note = '---\r\ntitle: A\r\ndone: true\r\n---\r\nWords.\r\n'
    expect(applied(note, removeProperty(note, 'title'))).toBe(
      '---\r\ndone: true\r\n---\r\nWords.\r\n',
    )
  })

  test('and changes nothing for a key the note does not have', () => {
    expect(removeProperty(NOTE, 'missing')).toBeNull()
  })
})
