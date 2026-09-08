import { describe, expect, test } from 'vitest'
import { tagCuts, tagsIn, tagSpans, tagUses } from './tags'

/** The twin of this file is the tests in tags.rs: the same notes, the same tags.
 *  A case added here belongs there too. */

describe('the tags in a note', () => {
  test('are the words after a hash, once per use', () => {
    expect(tagsIn('#work and #work again, plus #other')).toEqual(['#work', '#work', '#other'])
  })

  test('and a heading is not one of them', () => {
    expect(tagsIn('# Heading\n\n## Another')).toEqual([])
  })

  test('nor is a number, nor a hash inside a word', () => {
    expect(tagsIn('#42 and a#b')).toEqual([])
  })

  test('and a slash is part of the tag, to any depth', () => {
    expect(tagsIn('#work/nib/canvas/deep/deeper')).toEqual(['#work/nib/canvas/deep/deeper'])
    expect(tagsIn('#a-b #c_d #e/f')).toEqual(['#a-b', '#c_d', '#e/f'])
  })

  test('and code fences hold none', () => {
    expect(tagsIn('#yes\n```\n#no\n```\n#also')).toEqual(['#yes', '#also'])
  })
})

describe('the tags in the front matter', () => {
  const front = (lines: string) => tagsIn(`---\n${lines}\n---\n\nwords\n`)

  test('are read from a list on the key', () => {
    expect(front('tags: work/nib, other')).toEqual(['#work/nib', '#other'])
  })

  test('and from one in brackets, which is how Obsidian writes it', () => {
    expect(front('tags: [work/nib, other]')).toEqual(['#work/nib', '#other'])
  })

  test('and from items under the key', () => {
    expect(front('tags:\n  - work/nib\n  - other')).toEqual(['#work/nib', '#other'])
  })

  test('with the hash optional, since YAML reads one as a comment', () => {
    expect(front('tags: [#work/nib]')).toEqual(['#work/nib'])
  })

  test('under either spelling of the key', () => {
    expect(front('tag: work/nib')).toEqual(['#work/nib'])
  })

  test('and nothing under a key that is not the one', () => {
    expect(front('status: done\nproject: Nib')).toEqual([])
  })

  test('while the block itself is not read for hashes', () => {
    // A `#` in the front matter is a YAML comment, and the tags it holds have
    // been read from their key already.
    expect(front('status: done # not a tag')).toEqual([])
  })

  test('and both halves of a note count', () => {
    expect(tagsIn('---\ntags: [work]\n---\n\nwords #nib\n')).toEqual(['#work', '#nib'])
  })
})

describe('where a tag sits', () => {
  test('is the span of its name, hash not included', () => {
    const [use] = tagUses('a #work here')
    expect(use).toEqual({ tag: 'work', from: 3, to: 7 })
  })

  test('and asking for a node answers the span of that node alone', () => {
    const body = 'a #work/nib/canvas here'
    expect(tagSpans(body, 'work/nib')).toEqual([{ from: 3, to: 11 }])
    expect(body.slice(3, 11)).toBe('work/nib')
  })

  test('so a rename keeps whatever hung off the node', () => {
    const body = '#work/nib and #work/nib/canvas'
    const spans = tagSpans(body, 'work/nib')
    expect(spans).toHaveLength(2)

    let out = ''
    let at = 0
    for (const span of spans) {
      out += body.slice(at, span.from) + 'work/core'
      at = span.to
    }
    expect(out + body.slice(at)).toBe('#work/core and #work/core/canvas')
  })

  test('and a longer segment is not the node', () => {
    expect(tagSpans('#work/nibble', 'work/nib')).toEqual([])
  })

  test('folded, because the operator is', () => {
    expect(tagSpans('#Work/Nib', 'work/nib')).toEqual([{ from: 1, to: 9 }])
  })
})

describe('what taking a tag away has to cut', () => {
  /** The note with the tag gone. */
  const without = (body: string, path: string) => {
    let out = ''
    let at = 0
    for (const cut of tagCuts(body, path)) {
      out += body.slice(at, cut.from)
      at = cut.to
    }
    return out + body.slice(at)
  }

  test('the hash as well as the name', () => {
    expect(without('#work', 'work')).toBe('')
  })

  test('and the space that was holding it apart', () => {
    expect(without('words #work words', 'work')).toBe('words words')
  })

  test('and a space at the end of a line', () => {
    expect(without('words #work\nmore', 'work')).toBe('words\nmore')
  })

  test('and everything under the node', () => {
    expect(without('a #work/nib b #work/nib/canvas c', 'work/nib')).toBe('a b c')
  })

  test('but not a tag that only starts the same way', () => {
    expect(without('#work/nibble', 'work/nib')).toBe('#work/nibble')
  })

  test('and a list item that held nothing else goes with its line', () => {
    expect(without('---\ntags:\n  - work\n  - other\n---\n', 'work')).toBe(
      '---\ntags:\n  - other\n---\n',
    )
  })

  test('while one of several on a line leaves the line', () => {
    expect(without('---\ntags: [work, other]\n---\n', 'work')).toBe('---\ntags: [other]\n---\n')
  })
})
