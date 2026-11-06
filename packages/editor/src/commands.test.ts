import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import {
  calloutSign,
  closeFence,
  insertAiBlock,
  insertCallout,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertLink,
  insertHorizontalRule,
  insertSlideBreak,
  insertMathBlock,
  insertTable,
  insertToc,
  setCalloutSign,
  setHeading,
  shiftHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleTask,
  toggleTaskList,
  toggleWrap,
  tickTaskAtCaret,
} from './commands'
import { selectWord } from './keymap'
import { indentItems, moveLineOver, outdentItems } from './list-keys'
import { clearFormatting, marksAcross } from './marks'
import { nibMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function apply(
  command: StateCommand,
  doc: string,
  from: number,
  to = from,
): { took: boolean; doc: string; selection: [number, number] } {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  )

  let next = state
  const took = command({
    state,
    dispatch: (transaction: Transaction) => (next = transaction.state),
  })

  return {
    took,
    doc: next.doc.toString(),
    selection: [next.selection.main.from, next.selection.main.to],
  }
}

function marks(marked: string): { doc: string; from: number; to: number } {
  const caret = marked.indexOf('|')
  const doc = marked.replace(/[[\]|]/g, '')

  if (caret >= 0) return { doc, from: caret, to: caret }
  return { doc, from: marked.indexOf('['), to: marked.indexOf(']') - 1 }
}

function run(command: StateCommand, marked: string): string {
  const { doc, from, to } = marks(marked)
  return apply(command, doc, from, to).doc
}

function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  )
}

function at(command: StateCommand, doc: string, offset: number): string {
  return apply(command, doc, offset).doc
}

function took(command: StateCommand, marked: string): boolean {
  const { doc, from, to } = marks(marked)
  return apply(command, doc, from, to).took
}

function runSelection(command: StateCommand, marked: string): [number, number] {
  const { doc, from, to } = marks(marked)
  return apply(command, doc, from, to).selection
}

describe('a block that holds its lines', () => {
  const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n| 5 | 6 |'

  test('a block goes under a table, not under the row the caret is in', () => {
    const said = apply(insertHorizontalRule, TABLE, TABLE.indexOf('2')).doc
    expect(said).toBe(`${TABLE}\n\n---\n`)
  })

  test('and under a fence, whatever line of it the caret is on', () => {
    expect(run(insertHorizontalRule, '```\nco|de\nmore\n```\nb')).toBe(
      '```\ncode\nmore\n```\n\n---\n\nb',
    )
  })

  test('and under maths', () => {
    const state = parsed(
      EditorState.create({
        doc: '$$\na\nb\n$$',
        selection: EditorSelection.cursor(4),
        extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
      }),
    )
    let next = state
    insertHorizontalRule({ state, dispatch: (one: Transaction) => (next = one.state) })
    expect(next.doc.toString()).toBe('$$\na\nb\n$$\n\n---\n')
  })

  test('and under a quote, which a line of it does not end', () => {
    expect(run(insertHorizontalRule, '> on|e\n> two\n\nb')).toBe('> one\n> two\n\n---\n\n\nb')
  })

  test('a slide break goes after the selection and keeps it', () => {
    expect(run(insertSlideBreak, 'abc [def] ghi')).toBe('abc def\n\n---\n\n ghi')
    expect(run(insertSlideBreak, 'abc |def')).toBe('abc \n\n---\n\ndef')
  })

  test('a line moved with part of a table selected goes nowhere', () => {
    const doc = `words\n\n${TABLE}`
    const to = doc.indexOf('| a') + 3
    expect(apply(moveLineOver(1), doc, 0, to).doc).toBe(doc)
    expect(apply(moveLineOver(-1), doc, 0, to).doc).toBe(doc)
  })
})

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

  test('leaves the space and the line break at either edge outside the markers', () => {
    expect(run(strong, '[word\n]')).toBe('**word**\n')
    expect(run(strong, 'a[ word ]b')).toBe('a **word** b')
  })

  test('and takes the markers off again over the same selection', () => {
    expect(run(strong, '[**word**\n]')).toBe('word\n')
  })

  test('and keeps what was selected selected, inside the markers', () => {
    expect(runSelection(strong, '[word\n]')).toEqual([2, 6])
  })

  test('but a selection of nothing but space is wrapped as it is', () => {
    expect(run(strong, 'a[ ]b')).toBe('a** **b')
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

  test('the level a line already is turns it back into a paragraph', () => {
    expect(run(setHeading(2), '## |Title')).toBe('Title')
    expect(run(setHeading(1), '# |Title')).toBe('Title')
    expect(run(setHeading(6), '###### |Title')).toBe('Title')
  })

  test('while another level replaces it, as before', () => {
    expect(run(setHeading(2), '### |Title')).toBe('## Title')
  })

  test('over several lines, all of them or none', () => {
    expect(run(setHeading(2), '[## One\nTwo]')).toBe('## One\n## Two')
    expect(run(setHeading(2), '[## One\n## Two]')).toBe('One\nTwo')
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

  test('keeps a nested bullet nested when the list is made over it', () => {
    const doc = '- a\n  - b\nc'
    expect(apply(toggleBulletList, doc, 0, doc.length).doc).toBe('- a\n  - b\n- c')
  })

  test('takes off a nested bullet and a task box without the indent', () => {
    const doc = '- a\n  - [ ] b\n  - c'
    expect(apply(toggleBulletList, doc, 0, doc.length).doc).toBe('a\n  b\n  c')
  })

  test('leaves the line a selection ends in front of', () => {
    expect(apply(toggleBulletList, 'a\nb\nc', 0, 4).doc).toBe('- a\n- b\nc')
    expect(apply(setHeading(2), 'a\nb\nc', 0, 2).doc).toBe('## a\nb\nc')
    expect(apply(toggleBulletList, 'a\nb', 2).doc).toBe('a\n- b')
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

  test('ends a block on its own line where words follow', () => {
    expect(run(insertCodeFence, 'one |two\nthree')).toBe('one \n```\n\n```\ntwo\nthree')
    expect(run(insertMathBlock, 'one |two')).toBe('one \n$$\n\n$$\ntwo')
    expect(run(insertTable(1, 1), 'one |two')).toBe('one \n\n| Column 1 |\n| --- |\n|     |\n\ntwo')
    expect(run(insertCodeFence, '|two')).toBe('```\n\n```\ntwo')
  })

  test('sets a rule apart from the words above it', () => {
    expect(run(insertHorizontalRule, '[words]')).toBe('words\n\n---\n')
    expect(run(insertHorizontalRule, 'words|')).toBe('words\n\n---\n')
    expect(run(insertHorizontalRule, 'words\n|')).toBe('words\n\n---\n')
    expect(run(insertHorizontalRule, 'words\n\n|')).toBe('words\n\n---\n')
    expect(run(insertHorizontalRule, '|')).toBe('---\n')
  })

  test('goes below a line of structure rather than splitting it', () => {
    expect(run(insertCodeFence, '- [item]\n- two')).toBe('- item\n```\n\n```\n- two')
    expect(run(insertCodeFence, '> [quoted]')).toBe('> quoted\n```\n\n```')
    expect(run(insertCodeFence, '# [Title]\nwords')).toBe('# Title\n```\n\n```\nwords')
    expect(run(insertMathBlock, '1. it[em] b')).toBe('1. item b\n$$\n\n$$')
    expect(run(insertCodeFence, '- it|em')).toBe('- item\n```\n\n```')
    expect(run(insertCallout, '- [item]')).toBe('- item\n> [!NOTE]\n> ')
  })

  test('still wraps such lines selected whole', () => {
    expect(run(insertCodeFence, '[- one\n- two]')).toBe('```\n- one\n- two\n```')
  })

  test('closes a callout with a blank line where words follow', () => {
    expect(run(insertCallout, '[hello] world')).toBe('> [!NOTE]\n> hello\n\n world')
    expect(run(insertCallout, 'one |two')).toBe('one \n> [!NOTE]\n> \n\ntwo')
    expect(run(insertCallout, '[hello]\n\nnext')).toBe('> [!NOTE]\n> hello\n\nnext')
    expect(runSelection(insertCallout, 'one |two')).toEqual([17, 17])
  })

  test('sets a table apart from the words round it', () => {
    expect(run(insertTable(1, 1), 'he [llo] world')).toBe(
      'he llo\n\n| Column 1 |\n| --- |\n|     |\n\n world',
    )
    expect(run(insertTable(1, 1), '[words]\nnext')).toBe(
      'words\n\n| Column 1 |\n| --- |\n|     |\n\nnext',
    )
    expect(run(insertTable(1, 1), 'above\n|')).toBe('above\n\n| Column 1 |\n| --- |\n|     |')
  })

  test('does not put a table inside a table', () => {
    const inside = '| a | b |\n| --- | --- |'
    expect(apply(insertTable(1, 1), inside, 2, 3).doc).toBe(inside)
  })

  test('puts the caret of an AI block on its empty line', () => {
    expect(run(insertAiBlock, '|')).toBe('```ai\n\n```\n')
    expect(runSelection(insertAiBlock, '|')).toEqual([6, 6])
  })

  test('adds no second line break to a block that ends in one', () => {
    expect(run(insertToc, 'one |two')).toBe('one \n[toc]\ntwo')
  })

  test('keeps the caret inside the block', () => {
    expect(runSelection(insertCodeFence, 'one |two')).toEqual([8, 8])
  })

  test('wraps the lines selected in a fence, a math block or a callout', () => {
    expect(run(insertCodeFence, '[one\ntwo]\nthree')).toBe('```\none\ntwo\n```\nthree')
    expect(run(insertMathBlock, '[one\ntwo]\nthree')).toBe('$$\none\ntwo\n$$\nthree')
    expect(run(insertCallout, '[one\ntwo]\nthree')).toBe('> [!NOTE]\n> one\n> two\n\nthree')
  })

  test('wraps a word on its own lines, with what was round it on theirs', () => {
    expect(run(insertCodeFence, 'a [word] b')).toBe('a \n```\nword\n```\n b')
  })

  test('leaves the line break that ends a selection of whole lines outside the block', () => {
    expect(run(insertCodeFence, '[one\n]two')).toBe('```\none\n```\ntwo')
  })

  test('puts the caret where the language goes on a fence, and after the words otherwise', () => {
    expect(runSelection(insertCodeFence, '[one]')).toEqual([3, 3])
    expect(runSelection(insertMathBlock, '[one]')).toEqual([6, 6])
  })

  test('fences a selection that holds a fence with a longer one', () => {
    expect(run(insertCodeFence, '[```\nx\n```]')).toBe('````\n```\nx\n```\n````')
  })

  test('keeps the words of a selection a block has no room for', () => {
    expect(run(insertTable(1, 1), '[one\ntwo]\nthree')).toBe(
      'one\ntwo\n\n| Column 1 |\n| --- |\n|     |\n\nthree',
    )
    expect(run(insertToc, 'a [word] b')).toBe('a word\n[toc]\n b')
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

  test('keeps the underscores inside a word', () => {
    expect(run(clearFormatting, '[see my_file_name.txt and __b__ _i_]')).toBe(
      'see my_file_name.txt and b i',
    )
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
  function press(marked: string): { took: boolean; doc: string } {
    const caret = marked.indexOf('|')
    const doc = marked.replace(/\|/g, '')
    const state = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(caret),
        extensions: [markdown({ base: markdownLanguage })],
      }),
    )

    let next = state
    const took = closeFence({
      state,
      dispatch: (transaction: Transaction) => (next = transaction.state),
    })
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

describe('a task list', () => {
  test('makes plain lines into tasks', () => {
    expect(run(toggleTaskList, '[one\ntwo]')).toBe('- [ ] one\n- [ ] two')
  })

  test('trades a bullet for a box and keeps the indentation', () => {
    expect(run(toggleTaskList, '  - |one')).toBe('  - [ ] one')
  })

  test('trades a number for a box', () => {
    expect(run(toggleTaskList, '1. |one')).toBe('- [ ] one')
  })

  test('takes the tasks off again when every line is one', () => {
    const doc = '- [ ] one\n- [x] two'
    expect(apply(toggleTaskList, doc, 0, doc.length).doc).toBe('one\ntwo')
  })

  test('puts the box inside a quote, and takes it off again', () => {
    expect(run(toggleTaskList, '> |c')).toBe('> - [ ] c')
    expect(at(toggleTaskList, '> - [ ] c', 8)).toBe('> c')
    expect(run(toggleTaskList, '> > - |c')).toBe('> > - [ ] c')
  })

  test('makes tasks of every line when only some of them are', () => {
    const doc = '- [x] one\ntwo'
    expect(apply(toggleTaskList, doc, 0, doc.length).doc).toBe('- [ ] one\n- [ ] two')
  })
})

describe('ticking the task under the caret', () => {
  test('ticks an empty box', () => {
    expect(apply(toggleTask, '- [ ] wash up', 10).doc).toBe('- [x] wash up')
  })

  test('clears a ticked one', () => {
    expect(apply(toggleTask, '- [x] wash up', 10).doc).toBe('- [ ] wash up')
  })

  test('ticks every task in the selection', () => {
    const doc = '- [ ] one\n- [ ] two'
    expect(apply(toggleTask, doc, 0, doc.length).doc).toBe('- [x] one\n- [x] two')
  })

  test('makes a task of words, a bullet, a number or an empty line', () => {
    expect(run(toggleTask, 'just words|')).toBe('- [ ] just words')
    expect(run(toggleTask, '  - a bullet|')).toBe('  - [ ] a bullet')
    expect(run(toggleTask, '1. a number|')).toBe('- [ ] a number')
    expect(run(toggleTask, '|')).toBe('- [ ] ')
    expect(runSelection(toggleTask, '|')).toEqual([6, 6])
  })

  test('ticks the task it has just made on the next press', () => {
    const first = apply(toggleTask, 'milk', 4)
    expect(apply(toggleTask, first.doc, first.selection[0]).doc).toBe('- [x] milk')
  })

  test('makes tasks and ticks them line by line over a selection', () => {
    const doc = '- [ ] one\ntwo'
    expect(apply(toggleTask, doc, 0, doc.length).doc).toBe('- [x] one\n- [ ] two')
  })

  test('gives way in code, a heading, a quote and a table', () => {
    expect(took(toggleTask, '```\n- [ ] still code|\n```')).toBe(false)
    expect(took(toggleTask, '```py\nprint()|\n```')).toBe(false)
    expect(took(toggleTask, '# A heading|')).toBe(false)
    expect(took(toggleTask, '> quoted|')).toBe(false)
    const table = '| a | b |\n| - | - |\n| 1 | 2 |'
    expect(apply(toggleTask, table, table.length - 2).took).toBe(false)
  })
})

describe('ticking the task the caret is on, and nothing else', () => {
  test('ticks an empty box and clears a ticked one, wherever on the line the caret is', () => {
    expect(apply(tickTaskAtCaret, '- [ ] wash up', 0).doc).toBe('- [x] wash up')
    expect(apply(tickTaskAtCaret, '- [x] wash up', 13).doc).toBe('- [ ] wash up')
    expect(apply(tickTaskAtCaret, '  - [ ] nested', 9).doc).toBe('  - [x] nested')
  })

  test('only the line the caret is on', () => {
    expect(apply(tickTaskAtCaret, '- [ ] one\n- [ ] two', 12).doc).toBe('- [ ] one\n- [x] two')
  })

  test('leaves a line that is not a task alone, and says so', () => {
    for (const doc of ['just words', '- a bullet', '1. a number', '']) {
      const done = apply(tickTaskAtCaret, doc, doc.length)
      expect(done.took, doc).toBe(false)
      expect(done.doc).toBe(doc)
    }
  })

  test('gives way in code, where a box is not a box', () => {
    expect(took(tickTaskAtCaret, '```\n- [ ] still code|\n```')).toBe(false)
  })

  test('leaves a selection over more than one line alone', () => {
    const doc = '- [ ] one\n- [ ] two'
    expect(apply(tickTaskAtCaret, doc, 0, doc.length).took).toBe(false)
  })
})

describe('the blocks a menu row inserts', () => {
  test('a callout is the alert the renderer draws, ready to be written in', () => {
    expect(run(insertCallout, '|')).toBe('> [!NOTE]\n> ')
    expect(runSelection(insertCallout, '|')).toEqual([12, 12])
  })

  test('a table of contents is a line of its own', () => {
    expect(run(insertToc, 'words\n|')).toBe('words\n[toc]\n')
  })

  test('front matter goes to the very top, whatever the caret was doing', () => {
    expect(run(insertFrontMatter, '# Head\n\nwords|')).toBe('---\ntitle: \n---\n\n# Head\n\nwords')
    expect(runSelection(insertFrontMatter, 'words|')).toEqual([11, 11])
  })

  test('front matter that is there already gets the caret rather than a second block', () => {
    const note = '---\ntitle: Hi\n---\n\nwords|'
    expect(run(insertFrontMatter, note)).toBe('---\ntitle: Hi\n---\n\nwords')
    expect(runSelection(insertFrontMatter, note)).toEqual([13, 13])
  })

  test('a comment wraps what is selected, and unwraps it again', () => {
    expect(run(insertComment, 'a [word] b')).toBe('a <!-- word --> b')
    expect(run(insertComment, 'a [<!-- word -->] b')).toBe('a word b')
  })

  test('a comment with nothing selected leaves the caret inside it', () => {
    expect(run(insertComment, 'a |b')).toBe('a <!--  -->b')
    expect(runSelection(insertComment, 'a |b')).toEqual([7, 7])
  })
})

describe('a footnote', () => {
  test('marks the caret and puts its definition at the end of the note', () => {
    expect(run(insertFootnote, 'a claim|\n')).toBe('a claim[^1]\n\n[^1]: ')
  })

  test('leaves the caret in the definition, ready to write it', () => {
    expect(runSelection(insertFootnote, 'a claim|\n')).toEqual([19, 19])
  })

  test('takes the next number the note is not already using', () => {
    expect(apply(insertFootnote, 'one[^1] two\n\n[^1]: first\n', 11).doc).toBe(
      'one[^1] two[^2]\n\n[^1]: first\n\n[^2]: ',
    )
  })

  test('in an empty note is a mark and the definition under it', () => {
    expect(apply(insertFootnote, '', 0).doc).toBe('[^1]\n\n[^1]: ')
  })

  test('goes under the last of the words rather than under the blank lines', () => {
    expect(apply(insertFootnote, 'a claim\n\n\n', 7).doc).toBe('a claim[^1]\n\n[^1]: ')
  })

  test('never replaces what is selected: a footnote is added to it', () => {
    expect(apply(insertFootnote, 'a claim here\n', 2, 7).doc).toBe('a claim[^1] here\n\n[^1]: ')
  })
})

describe('a callout is asked to fold', () => {
  const CALLOUT = '> [!note] Mind the gap\n> and the step.\n'

  test('says nothing about folding until it is asked', () => {
    expect(calloutSign(stateOf(CALLOUT, 4))).toBe('')
    expect(run(insertCallout, '|')).toBe('> [!NOTE]\n> ')
  })

  test('and nothing at all where the caret is not in one', () => {
    expect(calloutSign(stateOf('Plain words.\n', 3))).toBeNull()
    expect(calloutSign(stateOf('> A plain quote\n', 5))).toBeNull()
    expect(took(setCalloutSign('-'), 'Plain |words.')).toBe(false)
  })

  test('takes the sign after the brackets, where Obsidian writes it', () => {
    expect(at(setCalloutSign('+'), CALLOUT, 4)).toBe('> [!note]+ Mind the gap\n> and the step.\n')
    expect(at(setCalloutSign('-'), CALLOUT, 4)).toBe('> [!note]- Mind the gap\n> and the step.\n')
  })

  test('from a caret anywhere in the callout, not only on its first line', () => {
    expect(at(setCalloutSign('-'), CALLOUT, CALLOUT.indexOf('step'))).toBe(
      '> [!note]- Mind the gap\n> and the step.\n',
    )
  })

  test('asked for the sign it already has, takes it off again', () => {
    const folded = '> [!note]- Mind the gap\n'
    expect(at(setCalloutSign('-'), folded, 4)).toBe('> [!note] Mind the gap\n')
    expect(calloutSign(stateOf(folded, 4))).toBe('-')
  })

  test('and asked for the other one, trades it', () => {
    expect(at(setCalloutSign('+'), '> [!note]- Mind the gap\n', 4)).toBe(
      '> [!note]+ Mind the gap\n',
    )
    expect(calloutSign(stateOf('> [!note]+ Mind the gap\n', 4))).toBe('+')
  })

  test('leaves a callout with no title of its own a callout with no title', () => {
    expect(at(setCalloutSign('-'), '> [!tip]\n> Below it.\n', 4)).toBe('> [!tip]-\n> Below it.\n')
  })
})

describe('italic over a word that is bold', () => {
  const italic = toggleWrap('*')
  const bold = toggleWrap('**')

  test('adds to the marks rather than taking a star of them', () => {
    expect(run(italic, '**[word]**')).toBe('***word***')
    expect(run(italic, '[**word**]')).toBe('***word***')
  })

  test('comes back off', () => {
    expect(run(italic, '***[word]***')).toBe('**word**')
    expect(run(italic, '[***word***]')).toBe('**word**')
    expect(run(italic, '*[word]*')).toBe('word')
    expect(run(bold, '***[word]***')).toBe('*word*')
    expect(run(bold, '*[word]*')).toBe('***word***')
  })
})

describe('marks across blocks', () => {
  const bold = marksAcross('**')

  test('go on each paragraph, since a run ends with its block', () => {
    expect(run(bold, '[one\ntwo\n\nthree]')).toBe('**one**\n**two**\n\n**three**')
  })

  test('go inside each item', () => {
    expect(run(bold, '[- a\n- b]\n')).toBe('- **a**\n- **b**\n')
  })

  test('come off again, and a selection starts where it starts', () => {
    expect(run(bold, '[**a**\n\n**b**]')).toBe('a\n\nb')
    expect(run(bold, 'x [a\n\nb] y')).toBe('x **a**\n\n**b** y')
  })
})

describe('a heading over a list item', () => {
  test('trades the marker rather than standing in front of it', () => {
    expect(run(setHeading(2), '- ite|m')).toBe('## item')
    expect(run(setHeading(2), '1. ite|m')).toBe('## item')
    expect(at(setHeading(2), '- [ ] item', 8)).toBe('## item')
  })
})

describe('clear formatting over code', () => {
  test('leaves a fence as it is', () => {
    const doc = '```\n**b** `c`\n```'
    expect(apply(clearFormatting, `a **b**\n\n${doc}`, 0, doc.length + 9).doc).toBe(`a b\n\n${doc}`)
  })

  test("takes a code span's marks and none of what it holds", () => {
    expect(run(clearFormatting, '[`**b**` **c**]')).toBe('**b** c')
  })
})

describe('Tab on a list item', () => {
  test('under a number goes as far as the words above it', () => {
    expect(at(indentItems, '1. x\n2. y\n3. z', 6)).toBe('1. x\n   1. y\n3. z')
    expect(at(indentItems, '10. x\n11. y', 7)).toBe('10. x\n    1. y')
    expect(at(indentItems, '1. x\n- y', 6)).toBe('1. x\n   - y')
  })

  test('under a bullet is what it always was', () => {
    expect(at(indentItems, '- x\n- y', 5)).toBe('- x\n  - y')
  })

  test('continues a list nested already', () => {
    expect(at(indentItems, '1. x\n   1. y\n2. z', 15)).toBe('1. x\n   1. y\n   2. z')
  })

  test('back out goes where it came from, and counts on', () => {
    expect(at(outdentItems, '1. x\n   1. y', 8)).toBe('1. x\n2. y')
    expect(at(outdentItems, '- x\n    - y', 9)).toBe('- x\n- y')
  })

  test('leaves words and code to the plain indent', () => {
    expect(at(indentItems, 'words', 1)).toBe('  words')
    expect(at(outdentItems, '  words', 3)).toBe('words')
    expect(at(indentItems, '```\n1. x\n2. y\n```', 11)).toBe('```\n1. x\n  2. y\n```')
  })
})

describe('moving a line past a table', () => {
  const TABLE = '| x |\n| - |\n| 1 |'

  test('going down steps over it whole', () => {
    expect(at(moveLineOver(1), `a\n\n${TABLE}\n\nb`, 0)).toBe(`${TABLE}\n\na\n\nb`)
    expect(at(moveLineOver(1), `a\n${TABLE}`, 0)).toBe(`${TABLE}\n\na`)
  })

  test('going up steps over it whole', () => {
    expect(at(moveLineOver(-1), `b\n\n${TABLE}\n\na`, 20 + 3)).toBe(`b\n\na\n\n${TABLE}`)
  })

  test('takes the caret with it', () => {
    const moved = apply(moveLineOver(1), `ab\n\n${TABLE}`, 1)
    expect(moved.selection).toEqual([TABLE.length + 3, TABLE.length + 3])
  })

  test('leaves any other line to the library', () => {
    expect(at(moveLineOver(1), 'a\nb', 0)).toBe('b\na')
    expect(at(moveLineOver(-1), 'a\nb', 2)).toBe('b\na')
  })
})

describe('a block inserted in the middle of a line', () => {
  test('a table keeps the words on either side and is a table', () => {
    expect(run(insertTable(1, 1), 'abc |def')).toBe('abc \n\n| Column 1 |\n| --- |\n|     |\n\ndef')
  })

  test('keeps what was selected', () => {
    expect(run(insertTable(1, 1), '[words]')).toBe('words\n\n| Column 1 |\n| --- |\n|     |')
  })

  test('a rule writes its own line break', () => {
    expect(run(insertHorizontalRule, 'a|b')).toBe('a\n\n---\nb')
  })
})

describe('marks over a selection that holds what is not words', () => {
  const across = (doc: string, mark = '**') => {
    const state = parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.range(0, doc.length),
        extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
      }),
    )
    let next = state
    marksAcross(mark)({ state, dispatch: (one: Transaction) => (next = one.state) })
    return next.doc.toString()
  }

  test.each([
    ['front matter', '---\ntitle: x\n---\n\npara', '---\ntitle: x\n---\n\n**para**'],
    ['a table', 'a\n\n| x |\n| --- |\n| 1 |\n\nb', '**a**\n\n| x |\n| --- |\n| 1 |\n\n**b**'],
    ['maths', 'a\n\n$$\nx\n$$\n\nb', '**a**\n\n$$\nx\n$$\n\n**b**'],
    ['html', 'a\n\n<div>\nb\n</div>\n\nc', '**a**\n\n<div>\nb\n</div>\n\n**c**'],
    ['a rule', 'a\n\n---\n\nb', '**a**\n\n---\n\n**b**'],
    ['a link definition', 'a\n\n[x]: http://u\n\nb', '**a**\n\n[x]: http://u\n\n**b**'],
    ['a fence', 'a\n\n```\ncode\n```\n\nb', '**a**\n\n```\ncode\n```\n\n**b**'],
    ['a block name', 'a ^abc123\n\nb\n\n^own', '**a** ^abc123\n\n**b**\n\n^own'],
  ])('leaves %s as it is', (_what, doc, wanted) => {
    expect(across(doc)).toBe(wanted)
  })

  test('front matter with nothing after it, and soft lines stay one run', () => {
    expect(across('---\ntitle: x\n---')).toBe('---\ntitle: x\n---')
    expect(across('one\ntwo')).toBe('**one\ntwo**')
    expect(across('**one\ntwo**')).toBe('one\ntwo')
  })

  test('italic over bold paragraphs adds to them, and comes off', () => {
    expect(across('**a**\n\n**b**', '*')).toBe('***a***\n\n***b***')
    expect(across('***a***\n\n***b***', '*')).toBe('**a**\n\n**b**')
    expect(across('*a*\n\n*b*', '*')).toBe('a\n\nb')
  })

  test('toggling one line leaves its name out of the marks', () => {
    expect(run(toggleWrap('**'), '[a ^abc123]')).toBe('**a** ^abc123')
  })
})

describe('a table with something after it', () => {
  test('keeps a blank line, or the next line is a row', () => {
    expect(run(insertTable(1, 1), 'abc|\nnext')).toBe(
      'abc\n\n| Column 1 |\n| --- |\n|     |\n\nnext',
    )
    expect(run(insertTable(1, 1), '|\nnext')).toBe('| Column 1 |\n| --- |\n|     |\n\nnext')
    expect(run(insertTable(1, 1), 'above\n|')).toBe('above\n\n| Column 1 |\n| --- |\n|     |')
  })
})

describe('Tab with what hangs under an item', () => {
  test('children go with their parent', () => {
    expect(at(indentItems, '1. a\n2. b\n   - c', 6)).toBe('1. a\n   1. b\n      - c')
    expect(at(indentItems, '- a\n- b\n  - c\n\n    more\n- d', 5)).toBe(
      '- a\n  - b\n    - c\n\n      more\n- d',
    )
    expect(at(outdentItems, '- a\n  - b\n    - c\n- d', 6)).toBe('- a\n- b\n  - c\n- d')
  })

  test('a selection counts on', () => {
    expect(apply(indentItems, '1. a\n2. b\n3. c', 6, 14).doc).toBe('1. a\n   1. b\n   2. c')
  })

  test('a first item keeps its number', () => {
    expect(at(indentItems, '5. a', 1)).toBe('  5. a')
  })

  test('in a quote stays in the quote', () => {
    expect(at(indentItems, '> 1. a\n> 2. b', 10)).toBe('> 1. a\n>    1. b')
    expect(at(outdentItems, '> 1. a\n>    1. b', 14)).toBe('> 1. a\n> 2. b')
  })
})

describe('moving a line past a table, with a line beside it', () => {
  const TABLE = '| x |\n| - |\n| 1 |'

  test('going up, the line under it is not left to be a row', () => {
    expect(at(moveLineOver(-1), `${TABLE}\n\na\nb`, TABLE.length + 2)).toBe(`a\n\n${TABLE}\n\nb`)
  })

  test('going down, the line over it is not left on its head', () => {
    expect(at(moveLineOver(1), `a\nb\n\n${TABLE}`, 2)).toBe(`a\n\n${TABLE}\n\nb`)
  })
})
