import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import {
  clearFormatting,
  closeFence,
  insertCodeFence,
  insertLink,
  insertMathBlock,
  insertTable,
  setHeading,
  shiftHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleWrap,
} from './commands'
import { selectWord } from './keymap'

/** Runs a command against a document and returns the resulting text.
 *  `|` marks the caret; `[` and `]` mark a selection. */
function run(command: StateCommand, marked: string): string {
  const selectionStart = marked.indexOf('[')
  const selectionEnd = marked.indexOf(']')
  const caret = marked.indexOf('|')

  const doc = marked.replace(/[[\]|]/g, '')
  const selection =
    caret >= 0
      ? EditorSelection.cursor(caret)
      : EditorSelection.range(selectionStart, selectionEnd - 1)

  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  })

  let next = state
  command({ state, dispatch: (transaction: Transaction) => (next = transaction.state) })
  return next.doc.toString()
}

/** Same, but reports the selection so caret placement can be checked. */
function runSelection(command: StateCommand, marked: string): [number, number] {
  const caret = marked.indexOf('|')
  const doc = marked.replace(/[[\]|]/g, '')

  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage })],
  })

  let next = state
  command({ state, dispatch: (transaction: Transaction) => (next = transaction.state) })
  return [next.selection.main.from, next.selection.main.to]
}

describe('inline wrapping', () => {
  const strong = toggleWrap('**')

  test('wraps a selection', () => {
    expect(run(strong, 'a [word] b')).toBe('a **word** b')
  })

  test('unwraps when the markers are outside the selection', () => {
    expect(run(strong, 'a **[word]** b')).toBe('a word b')
  })

  test('unwraps when the markers are inside the selection', () => {
    expect(run(strong, 'a [**word**] b')).toBe('a word b')
  })

  test('inserts empty markers at a caret', () => {
    expect(run(strong, 'a |b')).toBe('a ****b')
  })

  test('handles asymmetric markers', () => {
    expect(run(toggleWrap('<u>', '</u>'), '[x]')).toBe('<u>x</u>')
  })
})

describe('headings', () => {
  test('applies a level', () => {
    expect(run(setHeading(2), '|Title')).toBe('## Title')
  })

  test('replaces an existing level', () => {
    expect(run(setHeading(3), '# |Title')).toBe('### Title')
  })

  test('level zero returns to a paragraph', () => {
    expect(run(setHeading(0), '### |Title')).toBe('Title')
  })

  test('raises and lowers the level', () => {
    expect(run(shiftHeading(1), '## |Title')).toBe('### Title')
    expect(run(shiftHeading(-1), '## |Title')).toBe('# Title')
  })

  test('never goes past the ends of the scale', () => {
    expect(run(shiftHeading(1), '###### |Title')).toBe('###### Title')
    expect(run(shiftHeading(-1), '|Title')).toBe('Title')
  })
})

describe('line prefixes', () => {
  test('quotes and unquotes', () => {
    expect(run(toggleQuote, '|text')).toBe('> text')
    expect(run(toggleQuote, '> |text')).toBe('text')
  })

  test('toggles a bullet list', () => {
    expect(run(toggleBulletList, '|item')).toBe('- item')
    expect(run(toggleBulletList, '- |item')).toBe('item')
  })

  test('numbers an ordered list across lines', () => {
    expect(run(toggleOrderedList, '[one\ntwo\nthree]')).toBe('1. one\n2. two\n3. three')
  })

  test('converts a bullet list to an ordered one', () => {
    expect(run(toggleOrderedList, '[- one\n- two]')).toBe('1. - one\n2. - two')
  })
})

describe('blocks', () => {
  test('inserts a code fence with the caret inside', () => {
    expect(run(insertCodeFence, '|')).toBe('```\n\n```')
    expect(runSelection(insertCodeFence, '|')).toEqual([3, 3])
  })

  test('inserts a math block', () => {
    expect(run(insertMathBlock, '|')).toBe('$$\n\n$$')
  })

  test('inserts a table with a header and divider', () => {
    expect(run(insertTable(1, 2), '|')).toBe(
      '| Column 1 | Column 2 |\n| --- | --- |\n|     |     |',
    )
  })

  test('starts a block on its own line', () => {
    expect(run(insertCodeFence, 'text|')).toBe('text\n```\n\n```')
  })
})

describe('links', () => {
  test('wraps the selection and parks the caret in the target', () => {
    expect(run(insertLink, '[label]')).toBe('[label]()')
  })

  test('leaves the caret between the parentheses', () => {
    const [from] = runSelection(insertLink, 'x|')
    expect(from).toBe('x[]('.length)
  })
})

describe('clear formatting', () => {
  test('removes inline markers from the selection', () => {
    expect(run(clearFormatting, '[**a** *b* ~~c~~ ==d== `e`]')).toBe('a b c d e')
  })

  test('leaves text outside the selection alone', () => {
    expect(run(clearFormatting, '**keep** [**drop**]')).toBe('**keep** drop')
  })
})

describe('select word', () => {
  test('grows the selection to the word under the caret', () => {
    expect(runSelection(selectWord, 'one tw|o three')).toEqual([4, 7])
  })

  test('collapses on punctuation', () => {
    expect(runSelection(selectWord, 'one |- two')).toEqual([4, 4])
  })
})

describe('pressing Enter after a code fence', () => {
  /** Whether the command took the key, and what the document became. */
  function press(marked: string): { took: boolean; doc: string } {
    const caret = marked.indexOf('|')
    const doc = marked.replace(/\|/g, '')
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [markdown({ base: markdownLanguage })],
    })

    let next = state
    const took = closeFence({ state, dispatch: (transaction: Transaction) => (next = transaction.state) })
    return { took, doc: next.doc.toString() }
  }

  test('closes the fence and puts the caret inside it', () => {
    expect(press('```|')).toEqual({ took: true, doc: '```\n\n```' })
    expect(runSelection(closeFence, '```|')).toEqual([4, 4])
  })

  test('keeps the language', () => {
    expect(press('```ts|').doc).toBe('```ts\n\n```')
  })

  test('keeps what follows outside the block', () => {
    expect(press('```|\nmore text').doc).toBe('```\n\n```\nmore text')
  })

  test('closes tildes with tildes, and as many of them', () => {
    expect(press('~~~~|').doc).toBe('~~~~\n\n~~~~')
  })

  test('leaves a fence that is already closed alone', () => {
    expect(press('```|\ncode\n```').took).toBe(false)
  })

  test('leaves a closing fence alone', () => {
    expect(press('```\ncode\n```|').took).toBe(false)
  })

  test('does nothing away from the end of the line', () => {
    expect(press('``|`').took).toBe(false)
  })

  test('does nothing on an ordinary line', () => {
    expect(press('just words|').took).toBe(false)
  })
})
