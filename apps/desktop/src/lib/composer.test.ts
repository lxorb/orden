import { describe, expect, test } from 'vitest'
import { extracted, linkTo, merged, splitAt } from './composer'

describe('merging one note into another', () => {
  test('puts a rule at the seam and keeps both texts', () => {
    expect(merged('# A\n\none', '# B\n\ntwo')).toBe('# A\n\none\n\n---\n\n# B\n\ntwo\n')
  })

  test('settles the whitespace at the seam rather than welding the two', () => {
    expect(merged('# A\n\n\n\n', '\n\n# B\n')).toBe('# A\n\n---\n\n# B\n')
  })

  test('an empty note on either side is not a seam at all', () => {
    expect(merged('', '# B')).toBe('# B')
    expect(merged('# A', '   \n')).toBe('# A')
  })
})

describe('a link left behind', () => {
  test('is a wikilink to the note by name', () => {
    expect(linkTo('The Plan')).toBe('[[The Plan]]')
  })

  test('shows the words that were lifted out, when they are not the name', () => {
    expect(linkTo('The Plan', 'the plan itself')).toBe('[[The Plan|the plan itself]]')
    expect(linkTo('The Plan', 'The Plan')).toBe('[[The Plan]]')
    expect(linkTo('The Plan', '')).toBe('[[The Plan]]')
  })
})

describe('splitting a note at the caret', () => {
  const doc = '# Title\n\nfirst part\n\n## Later\n\nsecond part\n'

  test('the far side becomes a note named from its first heading', () => {
    const split = splitAt(doc, doc.indexOf('## Later'), 'Untitled')
    expect(split?.name).toBe('Later')
    expect(split?.taken).toBe('## Later\n\nsecond part\n')
  })

  test('a link to it is left where the text was', () => {
    const split = splitAt(doc, doc.indexOf('## Later'), 'Untitled')
    expect(split?.kept).toBe('# Title\n\nfirst part\n\n[[Later]]\n')
  })

  test('the caret is taken to the start of its own line first', () => {
    const split = splitAt(doc, doc.indexOf('Later'), 'Untitled')
    expect(split?.taken.startsWith('## Later')).toBe(true)
  })

  test('nothing after the caret is nothing to split', () => {
    expect(splitAt(doc, doc.length, 'Untitled')).toBeNull()
    expect(splitAt('# Title\n\n   \n', 8, 'Untitled')).toBeNull()
  })

  test('a name falls back when the far side has nothing to name it with', () => {
    const split = splitAt('a\n\n***\n', 3, 'Untitled')
    expect(split?.name).toBe('Untitled')
  })
})

describe('extracting a selection', () => {
  const doc = 'before The whole idea, written out. after'

  test('the selection becomes a note and a link takes its place', () => {
    const from = doc.indexOf('The whole')
    const to = doc.indexOf(' after')

    const carved = extracted(doc, from, to, 'Untitled')
    // The name is the passage as a filename: what a filesystem would refuse
    // goes, and the sentence's full stop with it. See note-name.ts.
    expect(carved?.name).toBe('The whole idea, written out')
    expect(carved?.taken).toBe('The whole idea, written out.\n')
    expect(carved?.kept).toBe(
      'before [[The whole idea, written out|The whole idea, written out.]] after',
    )
  })

  test('a long selection leaves a link showing the note name alone', () => {
    const long = `x${'word '.repeat(20)}y`
    const carved = extracted(`a ${long} b`, 2, 2 + long.length, 'Untitled')
    expect(carved?.kept).toBe(`a [[${carved?.name ?? ''}]] b`)
  })

  test('an empty selection is nothing to extract', () => {
    expect(extracted(doc, 3, 3, 'Untitled')).toBeNull()
    expect(extracted('a   b', 1, 4, 'Untitled')).toBeNull()
  })

  test('markup that opens the line is not part of the words shown', () => {
    const carved = extracted('- a point worth its own note\n', 0, 28, 'Untitled')
    expect(carved?.kept).toBe('[[a point worth its own note]]\n')
  })
})
