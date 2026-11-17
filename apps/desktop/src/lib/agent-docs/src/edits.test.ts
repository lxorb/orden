import { describe, expect, test } from 'vitest'
import { applied } from '@orden/scan/search/replace'
import { plan, readEdits } from './edits'
import { DocError } from './problem'

function edited(
  text: string,
  edits: unknown,
  selected: { from: number; to: number } | null = null,
) {
  return applied(text, plan(readEdits(edits), text, selected).edits)
}

describe('an edit', () => {
  test('replaces, inserts or deletes at what its anchor names', () => {
    const text = 'The plan is simple.'
    expect(edited(text, [{ at: { quote: 'simple' }, replace: 'late' }])).toBe('The plan is late.')
    expect(edited(text, [{ at: { quote: 'plan' }, insert_before: 'new ' }])).toBe(
      'The new plan is simple.',
    )
    expect(edited(text, [{ at: { quote: 'simple' }, insert_after: ' enough' }])).toBe(
      'The plan is simple enough.',
    )
    expect(edited(text, [{ at: { quote: ' simple' }, delete: true }])).toBe('The plan is.')
  })

  test('does exactly one thing', () => {
    expect(() => readEdits([{ at: { end: true }, replace: 'a', insert_after: 'b' }])).toThrow(
      'exactly one of',
    )
    expect(() => readEdits([{ at: { end: true } }])).toThrow(DocError)
    expect(() => readEdits([])).toThrow('at least one edit')
    const many = (n: number) =>
      Array.from({ length: n }, () => ({ at: { end: true }, delete: true }))
    expect(readEdits(many(500))).toHaveLength(500)
    expect(() => readEdits(many(501))).toThrow('at most 500 edits')
  })

  test('comes off the wire with one line ending', () => {
    expect(edited('a\n', [{ at: { end: true }, insert_after: 'b\r\nc' }])).toBe('a\n\nb\nc\n')
  })
})

describe('several edits in one call', () => {
  const TEXT = '# Plan\n\n- [ ] one\n- [ ] two\n\n# Log\nnothing yet\n'

  test('are resolved against the same words and applied together', () => {
    expect(
      edited(TEXT, [
        { at: { task: 'two' }, replace: '- [x] two' },
        { at: { quote: 'nothing yet' }, replace: 'shipped' },
        { at: { task: 'one' }, insert_after: '- [ ] one and a half' },
      ]),
    ).toBe('# Plan\n\n- [ ] one\n- [ ] one and a half\n- [x] two\n\n# Log\nshipped\n')
  })

  test('are refused whole when two of them change the same words', () => {
    expect(() =>
      edited(TEXT, [
        { at: { heading: 'Plan' }, delete: true },
        { at: { task: 'one' }, replace: 'x' },
      ]),
    ).toThrow('two of the edits change the same words')
  })

  test('keep their order where two go in at one place', () => {
    expect(
      edited('ab', [
        { at: { quote: 'a' }, insert_after: '1' },
        { at: { quote: 'b' }, insert_before: '2' },
      ]),
    ).toBe('a12b')
  })
})

describe('what goes in beside a line or a paragraph', () => {
  test('after a task is a line of its own', () => {
    expect(edited('- [ ] a\n- [ ] b\n', [{ at: { task: 'a' }, insert_after: '- [ ] new' }])).toBe(
      '- [ ] a\n- [ ] new\n- [ ] b\n',
    )
  })

  test('after a section is a paragraph before the next heading', () => {
    expect(
      edited('# A\nbody\n\n# B\nmore\n', [{ at: { heading: 'A' }, insert_after: 'Added.' }]),
    ).toBe('# A\nbody\n\nAdded.\n\n# B\nmore\n')
  })

  test('before a section is a paragraph after what came before it', () => {
    expect(edited('intro\n\n# B\n', [{ at: { heading: 'B' }, insert_before: 'Lead-in.' }])).toBe(
      'intro\n\nLead-in.\n\n# B\n',
    )
  })

  test('at the end is a paragraph, and the note still ends with its line break', () => {
    expect(edited('last line\n', [{ at: { end: true }, insert_after: 'P.S.' }])).toBe(
      'last line\n\nP.S.\n',
    )
    expect(edited('', [{ at: { end: true }, insert_after: 'first' }])).toBe('first')
  })

  test('at the start comes after the front matter, apart from what follows', () => {
    expect(
      edited('---\ntags: a\n---\n# Title\n', [{ at: { start: true }, insert_before: 'Summary' }]),
    ).toBe('---\ntags: a\n---\nSummary\n\n# Title\n')
  })

  test('a block replaced keeps its name, so links to it still arrive', () => {
    expect(
      edited('x\n\nthe idea ^idea\n\ny', [{ at: { block: 'idea' }, replace: 'a better idea' }]),
    ).toBe('x\n\na better idea ^idea\n\ny')
  })

  test('a block named on a list item is that item alone', () => {
    const list = 'Steps:\n\n- Buy milk\n- Pay rent ^p\n  by Friday\n- Call mum\n\nAfter.\n'
    expect(edited(list, [{ at: { block: 'p' }, delete: true }])).toBe(
      'Steps:\n\n- Buy milk\n- Call mum\n\nAfter.\n',
    )
    expect(edited(list, [{ at: { block: 'p' }, replace: '- Pay rent and water' }])).toBe(
      'Steps:\n\n- Buy milk\n- Pay rent and water ^p\n- Call mum\n\nAfter.\n',
    )
  })

  test('a block named on a list item with code under it takes the code, not the next item', () => {
    const note = '1. Install: ^x\n   ```bash\n   npm i\n\n   npm run build\n   ```\n2. Run it\n'
    expect(edited(note, [{ at: { block: 'x' }, delete: true }])).toBe('2. Run it\n')
  })

  test('a paragraph named above a list is that paragraph alone', () => {
    const note = 'Shopping: ^x\n- milk\n- eggs\n\nAfter.\n'
    expect(edited(note, [{ at: { block: 'x' }, replace: 'Groceries:' }])).toBe(
      'Groceries: ^x\n- milk\n- eggs\n\nAfter.\n',
    )
  })

  test('a block named apart under it is the table above the name', () => {
    const note = 'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n^tbl\n\nAfter.\n'
    expect(edited(note, [{ at: { block: 'tbl' }, replace: '| c |\n|---|\n| 3 |' }])).toBe(
      'Intro\n\n| c |\n|---|\n| 3 |\n\n^tbl\n\nAfter.\n',
    )
    expect(edited(note, [{ at: { block: 'tbl' }, delete: true }])).not.toContain('| 1 | 2 |')
  })

  test('a block next to front matter, maths, indented code or a heading is that block alone', () => {
    expect(
      edited('---\ntitle: Plan\n---\nFirst para ^p\n\nMore\n', [
        { at: { block: 'p' }, replace: 'New first' },
      ]),
    ).toBe('---\ntitle: Plan\n---\nNew first ^p\n\nMore\n')
    expect(
      edited('Intro\n\n$$\na\n\nb\n$$\n\n^m\n\n# Next\n\ntext\n', [
        { at: { block: 'm' }, replace: '$$\nc\n$$' },
      ]),
    ).toBe('Intro\n\n$$\nc\n$$\n\n^m\n\n# Next\n\ntext\n')
    expect(
      edited('Intro\n\n    code line\n\n| a | b |\n|---|---|\n\n^t\n\nAfter\n', [
        { at: { block: 't' }, delete: true },
      ]),
    ).toContain('    code line')
    expect(
      edited('Intro\n## Goals ^g\nShip it.\n\nAfter\n', [{ at: { block: 'g' }, delete: true }]),
    ).toContain('Intro')
  })

  test('a code block named on its closing fence is found and replaced whole', () => {
    expect(
      edited('a\n\n```\nx\n``` ^abc123\n\nb\n', [
        { at: { block: 'abc123' }, replace: '```\ny\n```' },
      ]),
    ).toBe('a\n\n```\ny\n``` ^abc123\n\nb\n')
  })

  test('a deleted task takes its line with it', () => {
    expect(edited('- [ ] a\n- [ ] b\n', [{ at: { task: 'a' }, delete: true }])).toBe('- [ ] b\n')
    expect(edited('- [ ] a\n- [ ] b\n', [{ at: { task: 'b' }, delete: true }])).toBe('- [ ] a\n')
  })

  test('a deleted section leaves no hole', () => {
    expect(edited('# A\none\n\n# B\ntwo\n\n# C\n', [{ at: { heading: 'B' }, delete: true }])).toBe(
      '# A\none\n\n# C\n',
    )
    expect(edited('# A\none\n\n# B\ntwo\n', [{ at: { heading: 'B' }, delete: true }])).toBe(
      '# A\none\n',
    )
  })

  test('the reader’s selection is words like a quote', () => {
    expect(edited('abcdef', [{ at: { selection: true }, replace: 'X' }], { from: 1, to: 3 })).toBe(
      'aXdef',
    )
  })
})
