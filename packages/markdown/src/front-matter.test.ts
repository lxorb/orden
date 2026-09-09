import { describe, expect, test } from 'vitest'
import { frontMatter, frontMatterEdit, frontMatterValue, stripFrontMatter } from './front-matter'

/** What the block is read as. The three readers of it - an export, a search and
 *  the icon a row wears - all come through these. */
describe('reading the front matter', () => {
  test('the block, and nothing where a note has none', () => {
    expect(frontMatter('---\ntitle: Hi\n---\n\nBody')).toBe('title: Hi')
    expect(frontMatter('No front matter')).toBeNull()
    // A rule in the middle of a note did not open a block.
    expect(frontMatter('# Title\n\n---\n\nmore')).toBeNull()
  })

  test('a closing fence is a line that says nothing else', () => {
    expect(frontMatter('---\ntitle: Hi\n----\n\nBody')).toBeNull()
    expect(frontMatter('---\ntitle: Hi\n--- and more\n\nBody')).toBeNull()
  })

  test('the note without it, which is what a renderer reads', () => {
    expect(stripFrontMatter('---\ntitle: Hi\n---\n# Title')).toBe('# Title')
    expect(stripFrontMatter('# Title')).toBe('# Title')
  })

  test('one key, quotes off, and never a key indented under another', () => {
    const source = '---\ntitle: "Field Notes"\nauthor: Ada\nexport:\n  paper: A5\n---\n\nBody'

    expect(frontMatterValue(source, 'title')).toBe('Field Notes')
    expect(frontMatterValue(source, 'author')).toBe('Ada')
    expect(frontMatterValue(source, 'paper')).toBeNull()
    expect(frontMatterValue(source, 'missing')).toBeNull()
  })

  test('a key with nothing after it says nothing', () => {
    expect(frontMatterValue('---\nicon:\n---\n', 'icon')).toBeNull()
  })
})

/** The surgery. Every case is one edit of the characters that moved, so a note
 *  open in a pane takes it without a caret in it going anywhere. */
describe('setting a key', () => {
  const applied = (source: string, key: string, value: string | null) => {
    const edit = frontMatterEdit(source, key, value)
    if (!edit) return source
    return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('opens a block on a note that has none', () => {
    expect(applied('# Plan\n\nwords\n', 'icon', 'rocket')).toBe(
      '---\nicon: rocket\n---\n# Plan\n\nwords\n',
    )
  })

  test('and on an empty note', () => {
    expect(applied('', 'icon', 'rocket')).toBe('---\nicon: rocket\n---\n')
  })

  test('goes in as the last line of a block that has other keys', () => {
    expect(applied('---\ntitle: Plan\ntags: [work]\n---\n\nwords', 'icon', 'rocket')).toBe(
      '---\ntitle: Plan\ntags: [work]\nicon: rocket\n---\n\nwords',
    )
  })

  test('replaces the value and leaves every other line alone', () => {
    expect(applied('---\nicon: rocket\ntitle: Plan\n---\nwords', 'icon', 'anchor')).toBe(
      '---\nicon: anchor\ntitle: Plan\n---\nwords',
    )
  })

  test('a key already saying it is not written again', () => {
    expect(frontMatterEdit('---\nicon: rocket\n---\n', 'icon', 'rocket')).toBeNull()
    expect(frontMatterEdit('---\nicon: "rocket"\n---\n', 'icon', 'rocket')).toBeNull()
  })

  test('keeps the line endings the file was written with', () => {
    expect(applied('---\r\ntitle: Plan\r\n---\r\nwords', 'icon', 'rocket')).toBe(
      '---\r\ntitle: Plan\r\nicon: rocket\r\n---\r\nwords',
    )
    expect(applied('# Plan\r\n', 'icon', 'rocket')).toBe('---\r\nicon: rocket\r\n---\r\n# Plan\r\n')
  })
})

describe('taking a key away', () => {
  const applied = (source: string, key: string) => {
    const edit = frontMatterEdit(source, key, null)
    if (!edit) return source
    return source.slice(0, edit.from) + edit.insert + source.slice(edit.to)
  }

  test('takes its line, and nothing else in the block', () => {
    expect(applied('---\ntitle: Plan\nicon: rocket\ntags: [work]\n---\nwords', 'icon')).toBe(
      '---\ntitle: Plan\ntags: [work]\n---\nwords',
    )
  })

  test('a block that held nothing else goes with it, blank lines and all', () => {
    expect(applied('---\nicon: rocket\n---\n\n# Plan\n', 'icon')).toBe('# Plan\n')
    expect(applied('---\nicon: rocket\n---\n', 'icon')).toBe('')
  })

  test('a note that never said it is left exactly as it was', () => {
    expect(frontMatterEdit('---\ntitle: Plan\n---\nwords', 'icon', null)).toBeNull()
    expect(frontMatterEdit('# Plan\n', 'icon', null)).toBeNull()
  })

  test('the same on a file written with the other line ending', () => {
    expect(applied('---\r\nicon: rocket\r\ntitle: Plan\r\n---\r\nwords', 'icon')).toBe(
      '---\r\ntitle: Plan\r\n---\r\nwords',
    )
    expect(applied('---\r\nicon: rocket\r\n---\r\n\r\n# Plan\r\n', 'icon')).toBe('# Plan\r\n')
  })
})
