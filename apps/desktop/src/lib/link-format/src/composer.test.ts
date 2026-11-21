import { describe, expect, test } from 'vitest'
import { decodeTarget, findLinks } from '@orden/markdown/links'
import { extracted, splitAt } from './carve'
import { linkTo, merged } from './composer'

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
  test('takes the front matter of the note that goes into the one it joins', () => {
    const from = '---\naliases: [F]\ntags: [work]\nstatus: draft\n---\n# From\n\nbody\n'
    expect(merged('# Into\n\ntext', from)).toBe(
      '---\naliases: [F]\ntags: [work]\nstatus: draft\n---\n# Into\n\ntext\n\n---\n\n# From\n\nbody\n',
    )
  })
  test('joins the aliases and tags of both, and keeps the values the note joined already had', () => {
    const into = '---\naliases:\n  - I\nstatus: done\n---\n# Into\n'
    const from = '---\naliases: [F, I]\ntags: [work]\nstatus: draft\n---\n# From\n'
    expect(merged(into, from)).toBe('---\nstatus: done\naliases: [I, F]\ntags: [work]\n---\n# Into\n\n---\n\n# From\n')
  })
})
describe('a merge into a note that has front matter', () => {
  test('carries over a key that was the only one the moved note had', () => {
    expect(merged('---\nstatus: done\n---\n# Into\n', '---\naliases: [F]\n---\n# From\n')).toBe(
      '---\nstatus: done\naliases: [F]\n---\n# Into\n\n---\n\n# From\n',
    )
  })
  test('carries over a key written in quotes', () => {
    expect(merged('---\nstatus: done\n---\n# Into\n', '---\n"my key": 1\nb: 2\n---\n# From\n')).toBe(
      '---\nstatus: done\n"my key": 1\nb: 2\n---\n# Into\n\n---\n\n# From\n',
    )
  })
  test('closes front matter the moved note left without an ending line', () => {
    expect(merged('# Into\n', '---\na: 1\n---')).toBe('---\na: 1\n---\n# Into')
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
  test.each(['Report.pdf', 'Ideas.canvas', 'CHANGELOG.md'])(
    'a link to a note named %s keeps the .md that makes it a note',
    (name) => {
      const split = splitAt(`# Title\n\n## ${name}\n\nmore\n`, 9, 'Untitled')
      expect(split?.kept).toBe(`# Title\n\n[[${name}.md]]\n`)
      const cut = extracted(`See ${name}.`, 4, 4 + name.length, 'Untitled')
      expect(cut?.kept).toBe(`See [[${name}.md]].`)
    },
  )
  test.each(['Using `git` well', 'it`s odd'])(
    'a link to a note named %s still reaches it past the backticks',
    (name) => {
      const reached = (text: string | undefined) => findLinks(text ?? '').map((link) => decodeTarget(link.target))
      const split = splitAt(`# Title\n\n## ${name}\n\nmore \`x\`\n`, 9, 'Untitled')
      expect(reached(split?.kept)).toEqual([`${name}.md`])
      const cut = extracted(`See ${name} and \`y\`.`, 4, 4 + name.length, 'Untitled')
      expect(reached(cut?.kept)).toEqual([`${name}.md`])
    },
  )
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
  test('names the link it leaves by the words a heading shows, not its markdown', () => {
    const doc = '## [Lateral Raise Machine](https://example.com/raise) for `arms`\n\nthree sets\n'
    expect(extracted(doc, 0, doc.length, 'Untitled', 'Raise')?.kept).toBe('[[Raise|Lateral Raise Machine for arms]]\n')
    const plain = '## [Lateral Raise Machine](https://example.com/raise)\n\nthree sets\n'
    expect(extracted(plain, 0, plain.length, 'Untitled', 'Lateral Raise Machine')?.kept).toBe(
      '[[Lateral Raise Machine]]\n',
    )
  })
  const doc = 'before The whole idea, written out. after'
  test('the selection becomes a note and a link takes its place', () => {
    const from = doc.indexOf('The whole')
    const to = doc.indexOf(' after')
    const carved = extracted(doc, from, to, 'Untitled')
    expect(carved?.name).toBe('The whole idea, written out')
    expect(carved?.taken).toBe('The whole idea, written out.\n')
    expect(carved?.kept).toBe('before [[The whole idea, written out]] after')
  })
  test('a whole line taken with its line break leaves the next line as it was', () => {
    const doc = '# Note\n\nIdea one is here.\n## Next\n\nmore\n'
    const from = doc.indexOf('Idea')
    const carved = extracted(doc, from, doc.indexOf('## Next'), 'Untitled')
    expect(carved?.kept).toBe('# Note\n\n[[Idea one is here]]\n## Next\n\nmore\n')
    const paragraphs = 'para one\n\npara two\n\npara three'
    const two = paragraphs.indexOf('para two')
    const cut = extracted(paragraphs, two, paragraphs.indexOf('para three'), 'Untitled')
    expect(cut?.kept).toBe('para one\n\n[[para two]]\n\npara three')
  })
  test('words the name could not keep are shown by the link', () => {
    const doc = 'see Why it works: the whole of it here'
    const from = doc.indexOf('Why')
    const to = doc.indexOf(' here')
    const carved = extracted(doc, from, to, 'Untitled')
    expect(carved?.name).toBe('Why it works the whole of it')
    expect(carved?.kept).toBe('see [[Why it works the whole of it|Why it works: the whole of it]] here')
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
