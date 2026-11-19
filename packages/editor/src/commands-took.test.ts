import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Extension, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import {
  closeFence,
  insertAiBlock,
  insertCallout,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertLink,
  insertHorizontalRule,
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
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

const PLAIN = markdown({ base: markdownLanguage })
const NOTE = markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })

const stateOf = (doc: string, from: number, to = from, language: Extension = PLAIN) =>
  parsed(EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions: [language] }))

function apply(command: StateCommand, doc: string, from: number, to = from, language = PLAIN) {
  const state = stateOf(doc, from, to, language)
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

function applyMarked(command: StateCommand, marked: string) {
  const caret = marked.indexOf('|')
  const doc = marked.replace(/[[\]|]/g, '')
  return caret >= 0 ? apply(command, doc, caret) : apply(command, doc, marked.indexOf('['), marked.indexOf(']') - 1)
}

const run = (command: StateCommand, marked: string) => applyMarked(command, marked).doc
const took = (command: StateCommand, marked: string) => applyMarked(command, marked).took
const runSelection = (command: StateCommand, marked: string) => applyMarked(command, marked).selection
const at = (command: StateCommand, doc: string, offset: number) => apply(command, doc, offset).doc
const strong = toggleWrap('**')
const italic = toggleWrap('*')
const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n| 5 | 6 |'
const SMALL = '| x |\n| - |\n| 1 |'
const ONE_BY_ONE = '| Column 1 |\n| --- |\n|     |'
const CALLOUT = '> [!note] Mind the gap\n> and the step.\n'

const runs = (command: StateCommand, rows: [string, string][]) =>
  test.each(rows)('%j', (marked, wanted) => expect(run(command, marked)).toBe(wanted))
const ats = (command: StateCommand, rows: [string, number, string][]) =>
  test.each(rows)('%j at %i', (doc, offset, wanted) => expect(at(command, doc, offset)).toBe(wanted))
const selects = (command: StateCommand, rows: [string, number[]][]) =>
  test.each(rows)('%j', (marked, wanted) => expect(runSelection(command, marked)).toEqual(wanted))

runs(insertHorizontalRule, [
  ['```\nco|de\nmore\n```\nb', '```\ncode\nmore\n```\n\n---\n\nb'],
  ['> on|e\n> two\n\nb', '> one\n> two\n\n---\n\n\nb'],
  ['[words]', 'words\n\n---\n'],
  ['words|', 'words\n\n---\n'],
  ['words\n|', 'words\n\n---\n'],
  ['words\n\n|', 'words\n\n---\n'],
  ['|', '---\n'],
  ['a|b', 'a\n\n---\nb'],
])
runs(strong, [
  ['a [word] b', 'a **word** b'],
  ['a **[word]** b', 'a word b'],
  ['a [**word**] b', 'a word b'],
  ['a |b', 'a ****b'],
  ['[word\n]', '**word**\n'],
  ['a[ word ]b', 'a **word** b'],
  ['[**word**\n]', 'word\n'],
  ['a[ ]b', 'a** **b'],
  ['***[word]***', '*word*'],
  ['*[word]*', '***word***'],
  ['[a ^abc123]', '**a** ^abc123'],
])
runs(toggleWrap('<u>', '</u>'), [['[x]', '<u>x</u>']])
runs(setHeading(2), [
  ['|Title', '## Title'],
  ['## |Title', 'Title'],
  ['### |Title', '## Title'],
  ['[## One\nTwo]', '## One\n## Two'],
  ['[## One\n## Two]', 'One\nTwo'],
  ['- ite|m', '## item'],
  ['1. ite|m', '## item'],
])
runs(setHeading(3), [['# |Title', '### Title']])
runs(setHeading(0), [['### |Title', 'Title']])
runs(setHeading(1), [['# |Title', 'Title']])
runs(setHeading(6), [['###### |Title', 'Title']])
runs(shiftHeading(1), [
  ['## |Title', '### Title'],
  ['###### |Title', '###### Title'],
])
runs(shiftHeading(-1), [
  ['## |Title', '# Title'],
  ['|Title', 'Title'],
])
runs(toggleQuote, [
  ['|text', '> text'],
  ['> |text', 'text'],
])
runs(toggleBulletList, [
  ['|item', '- item'],
  ['- |item', 'item'],
  ['[1. one\n2. two]', '- one\n- two'],
])
runs(toggleOrderedList, [
  ['[one\ntwo\nthree]', '1. one\n2. two\n3. three'],
  ['[- one\n- two]', '1. one\n2. two'],
])
runs(insertCodeFence, [
  ['|', '```\n\n```'],
  ['text|', 'text\n```\n\n```'],
  ['one |two\nthree', 'one \n```\n\n```\ntwo\nthree'],
  ['|two', '```\n\n```\ntwo'],
  ['- [item]\n- two', '- item\n```\n\n```\n- two'],
  ['> [quoted]', '> quoted\n```\n\n```'],
  ['# [Title]\nwords', '# Title\n```\n\n```\nwords'],
  ['- it|em', '- item\n```\n\n```'],
  ['[- one\n- two]', '```\n- one\n- two\n```'],
  ['[one\ntwo]\nthree', '```\none\ntwo\n```\nthree'],
  ['a [word] b', 'a \n```\nword\n```\n b'],
  ['[one\n]two', '```\none\n```\ntwo'],
  ['[```\nx\n```]', '````\n```\nx\n```\n````'],
])
runs(insertMathBlock, [
  ['|', '$$\n\n$$'],
  ['one |two', 'one \n$$\n\n$$\ntwo'],
  ['1. it[em] b', '1. item b\n$$\n\n$$'],
  ['[one\ntwo]\nthree', '$$\none\ntwo\n$$\nthree'],
])
runs(insertTable(1, 2), [['|', '| Column 1 | Column 2 |\n| --- | --- |\n|     |     |']])
runs(insertTable(1, 1), [
  ['one |two', `one \n\n${ONE_BY_ONE}\n\ntwo`],
  ['he [llo] world', `he llo\n\n${ONE_BY_ONE}\n\n world`],
  ['[words]\nnext', `words\n\n${ONE_BY_ONE}\n\nnext`],
  ['above\n|', `above\n\n${ONE_BY_ONE}`],
  ['[one\ntwo]\nthree', `one\ntwo\n\n${ONE_BY_ONE}\n\nthree`],
  ['abc |def', `abc \n\n${ONE_BY_ONE}\n\ndef`],
  ['[words]', `words\n\n${ONE_BY_ONE}`],
  ['abc|\nnext', `abc\n\n${ONE_BY_ONE}\n\nnext`],
  ['|\nnext', `${ONE_BY_ONE}\n\nnext`],
])
runs(insertCallout, [
  ['- [item]', '- item\n> [!NOTE]\n> '],
  ['[hello] world', '> [!NOTE]\n> hello\n\n world'],
  ['one |two', 'one \n> [!NOTE]\n> \n\ntwo'],
  ['[hello]\n\nnext', '> [!NOTE]\n> hello\n\nnext'],
  ['[one\ntwo]\nthree', '> [!NOTE]\n> one\n> two\n\nthree'],
  ['|', '> [!NOTE]\n> '],
])
runs(insertAiBlock, [['|', '```ai\n\n```\n']])
runs(insertToc, [
  ['one |two', 'one \n[toc]\ntwo'],
  ['a [word] b', 'a word\n[toc]\n b'],
  ['words\n|', 'words\n[toc]\n'],
])
runs(insertLink, [['[label]', '[label]()']])
runs(clearFormatting, [
  ['**keep** [**drop**]', '**keep** drop'],
  ['[see my_file_name.txt and __b__ _i_]', 'see my_file_name.txt and b i'],
  ['[`**b**` **c**]', '**b** c'],
])
runs(closeFence, [
  ['```|', '```\n\n```'],
  ['```ts|', '```ts\n\n```'],
  ['```|\nmore text', '```\n\n```\nmore text'],
  ['~~~~|', '~~~~\n\n~~~~'],
])
runs(toggleTaskList, [
  ['[one\ntwo]', '- [ ] one\n- [ ] two'],
  ['  - |one', '  - [ ] one'],
  ['1. |one', '- [ ] one'],
  ['> |c', '> - [ ] c'],
  ['> > - |c', '> > - [ ] c'],
])
runs(toggleTask, [
  ['just words|', '- [ ] just words'],
  ['  - a bullet|', '  - [ ] a bullet'],
  ['1. a number|', '- [ ] a number'],
  ['|', '- [ ] '],
])
runs(insertComment, [
  ['a [word] b', 'a <!-- word --> b'],
  ['a [<!-- word -->] b', 'a word b'],
  ['a |b', 'a <!--  -->b'],
])
runs(insertFootnote, [['a claim|\n', 'a claim[^1]\n\n[^1]: ']])
runs(italic, [
  ['**[word]**', '***word***'],
  ['[**word**]', '***word***'],
  ['***[word]***', '**word**'],
  ['[***word***]', '**word**'],
  ['*[word]*', 'word'],
])
runs(marksAcross('**'), [
  ['[one\ntwo\n\nthree]', '**one**\n**two**\n\n**three**'],
  ['[- a\n- b]\n', '- **a**\n- **b**\n'],
  ['[**a**\n\n**b**]', 'a\n\nb'],
  ['x [a\n\nb] y', 'x **a**\n\n**b** y'],
])
ats(insertHorizontalRule, [[TABLE, TABLE.indexOf('2'), `${TABLE}\n\n---\n`]])
ats(toggleTaskList, [['> - [ ] c', 8, '> c']])
ats(toggleTask, [
  ['- [ ] wash up', 10, '- [x] wash up'],
  ['- [x] wash up', 10, '- [ ] wash up'],
  ['- [🎉] wash up', 11, '- [ ] wash up'],
])
ats(tickTaskAtCaret, [
  ['- [ ] wash up', 0, '- [x] wash up'],
  ['- [x] wash up', 13, '- [ ] wash up'],
  ['  - [ ] nested', 9, '  - [x] nested'],
  ['- [ ] one\n- [ ] two', 12, '- [ ] one\n- [x] two'],
])
ats(insertFootnote, [
  ['one[^1] two\n\n[^1]: first\n', 11, 'one[^1] two[^2]\n\n[^1]: first\n\n[^2]: '],
  ['', 0, '[^1]\n\n[^1]: '],
  ['a claim\n\n\n', 7, 'a claim[^1]\n\n[^1]: '],
])
ats(setCalloutSign('+'), [
  [CALLOUT, 4, '> [!note]+ Mind the gap\n> and the step.\n'],
  ['> [!note]- Mind the gap\n', 4, '> [!note]+ Mind the gap\n'],
])
ats(setCalloutSign('-'), [
  [CALLOUT, 4, '> [!note]- Mind the gap\n> and the step.\n'],
  [CALLOUT, CALLOUT.indexOf('step'), '> [!note]- Mind the gap\n> and the step.\n'],
  ['> [!note]- Mind the gap\n', 4, '> [!note] Mind the gap\n'],
  ['> [!tip]\n> Below it.\n', 4, '> [!tip]-\n> Below it.\n'],
])
ats(setHeading(2), [['- [ ] item', 8, '## item']])
ats(indentItems, [
  ['1. x\n2. y\n3. z', 6, '1. x\n   1. y\n3. z'],
  ['10. x\n11. y', 7, '10. x\n    1. y'],
  ['1. x\n- y', 6, '1. x\n   - y'],
  ['- x\n- y', 5, '- x\n  - y'],
  ['1. x\n   1. y\n2. z', 15, '1. x\n   1. y\n   2. z'],
  ['> > - x\n> > - y', 13, '> > - x\n> >   - y'],
  ['words', 1, '  words'],
  ['```\n1. x\n2. y\n```', 11, '```\n1. x\n  2. y\n```'],
  ['1. a\n2. b\n   - c', 6, '1. a\n   1. b\n      - c'],
  ['- a\n- b\n  - c\n\n    more\n- d', 5, '- a\n  - b\n    - c\n\n      more\n- d'],
  ['5. a', 1, '  5. a'],
  ['> 1. a\n> 2. b', 10, '> 1. a\n>    1. b'],
])
ats(outdentItems, [
  ['1. x\n   1. y', 8, '1. x\n2. y'],
  ['- x\n    - y', 9, '- x\n- y'],
  ['  words', 3, 'words'],
  ['- a\n  - b\n    - c\n- d', 6, '- a\n- b\n  - c\n- d'],
  ['> 1. a\n>    1. b', 14, '> 1. a\n> 2. b'],
])
ats(moveLineOver(1), [
  [`a\n\n${SMALL}\n\nb`, 0, `${SMALL}\n\na\n\nb`],
  [`a\n${SMALL}`, 0, `${SMALL}\n\na`],
  ['a\nb', 0, 'b\na'],
  [`a\nb\n\n${SMALL}`, 2, `a\n\n${SMALL}\n\nb`],
])
ats(moveLineOver(-1), [
  [`b\n\n${SMALL}\n\na`, 23, `b\n\na\n\n${SMALL}`],
  ['a\nb', 2, 'b\na'],
  [`${SMALL}\n\na\nb`, SMALL.length + 2, `a\n\n${SMALL}\n\nb`],
])
selects(strong, [['[word\n]', [2, 6]]])
selects(insertCodeFence, [
  ['|', [3, 3]],
  ['one |two', [8, 8]],
  ['[one]', [3, 3]],
])
selects(insertCallout, [
  ['one |two', [17, 17]],
  ['|', [12, 12]],
])
selects(insertAiBlock, [['|', [6, 6]]])
selects(insertMathBlock, [['[one]', [6, 6]]])
selects(insertLink, [['x|', [4, 4]]])
selects(selectWord, [
  ['one tw|o three', [4, 7]],
  ['one |- two', [4, 4]],
])
selects(closeFence, [['```|', [4, 4]]])
selects(toggleTask, [['|', [6, 6]]])
selects(insertComment, [['a |b', [7, 7]]])
selects(insertFootnote, [['a claim|\n', [19, 19]]])

describe('over a range', () => {
  test.each<[string, number, number, string, StateCommand]>([
    [`words\n\n${TABLE}`, 0, 10, `words\n\n${TABLE}`, moveLineOver(1)],
    [`words\n\n${TABLE}`, 0, 10, `words\n\n${TABLE}`, moveLineOver(-1)],
    ['- a\n  - b\nc', 0, 11, '- a\n  - b\n- c', toggleBulletList],
    ['a\nb\nc', 0, 4, '- a\n- b\nc', toggleBulletList],
    ['a\nb\nc', 0, 2, '## a\nb\nc', setHeading(2)],
    ['a\nb', 2, 2, 'a\n- b', toggleBulletList],
    ['- [ ] task\n- [x] done', 0, 21, '1. [ ] task\n2. [x] done', toggleOrderedList],
    ['| a | b |\n| --- | --- |', 2, 3, '| a | b |\n| --- | --- |', insertTable(1, 1)],
    ['- [ ] one\n- [x] two', 0, 19, 'one\ntwo', toggleTaskList],
    ['- [x] one\ntwo', 0, 13, '- [ ] one\n- [ ] two', toggleTaskList],
    ['- [ ] one\n- [ ] two', 0, 19, '- [x] one\n- [x] two', toggleTask],
    ['- [ ] one\ntwo', 0, 13, '- [x] one\n- [ ] two', toggleTask],
    ['a claim here\n', 2, 7, 'a claim[^1] here\n\n[^1]: ', insertFootnote],
    ['1. a\n2. b\n3. c', 6, 14, '1. a\n   1. b\n   2. c', indentItems],
  ])('%j %i to %i', (doc, from, to, wanted, command) => {
    expect(apply(command, doc, from, to).doc).toBe(wanted)
  })

  test('a rule goes under maths', () => {
    expect(apply(insertHorizontalRule, '$$\na\nb\n$$', 4, 4, NOTE).doc).toBe('$$\na\nb\n$$\n\n---\n')
  })

  test('fences three hundred thousand lines, one fence longer than any inside', () => {
    const doc = Array.from({ length: 300_000 }, (_, at) => (at === 7 ? '````' : 'x')).join('\n')
    const fenced = apply(insertCodeFence, doc, 0, doc.length).doc
    expect(fenced).toContain('`````\nx\nx')
    expect(fenced.trimEnd().endsWith('x\n`````')).toBe(true)
  })

  test('a table row gives way to a task', () => {
    const table = '| a | b |\n| - | - |\n| 1 | 2 |'
    expect(apply(toggleTask, table, table.length - 2).took).toBe(false)
  })

  test('closing a fence says it took', () => {
    expect(took(closeFence, '```|')).toBe(true)
  })

  test('ticks the task it has just made on the next press', () => {
    const first = apply(toggleTask, 'milk', 4)
    expect(apply(toggleTask, first.doc, first.selection[0]!).doc).toBe('- [x] milk')
  })

  test('the caret ticks no line that is not a task, and says so', () => {
    for (const doc of ['just words', '- a bullet', '1. a number', ''])
      expect(apply(tickTaskAtCaret, doc, doc.length), doc).toMatchObject({ took: false, doc })
    expect(apply(tickTaskAtCaret, '- [ ] one\n- [ ] two', 0, 19).took).toBe(false)
  })

  test('a line quoted 28 deep costs no time', () => {
    const deep = `${'> '.repeat(28)}x`
    const started = Date.now()
    expect(at(indentItems, `${deep}\n${deep}`, deep.length + 3)).toBe(`${deep}\n  ${deep}`)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test('a line moved past a table takes the caret with it', () => {
    const moved = apply(moveLineOver(1), `ab\n\n${SMALL}`, 1)
    expect(moved.selection).toEqual([SMALL.length + 3, SMALL.length + 3])
  })

  test('clear formatting leaves a fence as it is', () => {
    const doc = '```\n**b** `c`\n```'
    expect(apply(clearFormatting, `a **b**\n\n${doc}`, 0, doc.length + 9).doc).toBe(`a b\n\n${doc}`)
  })
})
