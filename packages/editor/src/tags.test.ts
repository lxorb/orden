import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { tagCompletions } from './tags'
import { type NoteIndex, noteIndex, type SpaceTag } from './wikilink/notes'

const TAGS: SpaceTag[] = [
  { tag: 'work', notes: 12 },
  { tag: 'work/ink', notes: 7 },
  { tag: 'work/ink/canvas', notes: 2 },
  { tag: 'reading', notes: 4 },
]

const index = (tags: readonly SpaceTag[] = TAGS): NoteIndex => ({
  notes: [],
  files: [],
  path: null,
  tags,
  read: () => Promise.resolve(null),
})

function state(doc: string, at: number, space = index()): EditorState {
  const built = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at),
    extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), noteIndex.of(space)],
  })

  return built.update({}).state
}

const rowsAt = (doc: string, at = doc.length, space = index()): CompletionResult | null =>
  tagCompletions(new CompletionContext(state(doc, at, space), at, false))

const labels = (found: CompletionResult | null): string[] => (found?.options ?? []).map((one) => one.label)

describe('a hash in the middle of a line', () => {
  test.each([
    [rowsAt('Filed under #'), ['work', 'work/ink', 'work/ink/canvas', 'reading']],
    [rowsAt('#work/'), ['work/ink', 'work/ink/canvas']],
    [rowsAt('#work/ink/'), ['work/ink/canvas']],
    [rowsAt('#canvas'), ['work/ink/canvas']],
    [rowsAt('(#read'), ['reading']],
  ])('%j', (input, wanted) => expect(labels(input)).toEqual(wanted))

  test('says how many notes carry each one', () => {
    expect(rowsAt('Filed under #')?.options.map((one) => one.detail)).toEqual(['12', '7', '2', '4'])
  })

  test('starts the popup past the hash, so a chosen row is the name', () => {
    const found = rowsAt('Filed under #wo')
    expect(found?.from).toBe('Filed under #'.length)
    expect(labels(found)).toEqual(['work', 'work/ink', 'work/ink/canvas'])
  })

  test.each([['C#'], ['https://orden.dev/#read'], ['#work orden']])('%j', (input) => expect(rowsAt(input)).toBeNull())

  test('offers nothing until the app has said what the tags are', () => {
    expect(rowsAt('Filed under #', 13, index([]))).toBeNull()
  })
})

describe('a hash that opens a line', () => {
  test('waits for a letter, because `# ` there is a heading', () => {
    expect(rowsAt('#')).toBeNull()
    expect(rowsAt('  #')).toBeNull()
    expect(labels(rowsAt('#w'))).toEqual(['work', 'work/ink', 'work/ink/canvas'])
  })

  test.each([['# '], ['# Heading']])('%j', (input) => expect(rowsAt(input)).toBeNull())
})

describe('where the characters are not prose', () => {
  test.each([
    ['```py\n# work\n```', '```py\n# work\n```'.indexOf('# work') + 6],
    ['`#work`', 6],
    ['$a #work$', 8],
    ['[a](note.md#work', 16],
  ])('%j', (input, extra) => expect(rowsAt(input, extra)).toBeNull())

  test.each([['[[Plan#'], ['[[Plan#wo'], ['[[#']])('%j', (input) => expect(rowsAt(input)).toBeNull())
})

describe('the front matter', () => {
  const FRONT = '---\ntags: work\nother: yes\n---\n\nwords\n'

  test('offers the tags under a `tags:` key, with no hash to type', () => {
    const at = FRONT.indexOf('tags: work') + 'tags: wo'.length
    const found = rowsAt(FRONT, at)

    expect(labels(found)).toEqual(['work', 'work/ink', 'work/ink/canvas'])
    expect(found?.from).toBe(FRONT.indexOf('tags: work') + 'tags: '.length)
  })

  test.each([
    [
      rowsAt(
        '---\ntags:\n  - work\n  - re\n---\n\nwords\n',
        '---\ntags:\n  - work\n  - re\n---\n\nwords\n'.indexOf('- re') + 4,
      ),
      ['reading'],
    ],
    [
      rowsAt('---\ntags: [work, re\n---\n\nwords\n', '---\ntags: [work, re\n---\n\nwords\n'.indexOf('re') + 2),
      ['reading'],
    ],
  ])('%j', (input, wanted) => expect(labels(input)).toEqual(wanted))

  test.each([
    [FRONT, FRONT.indexOf('other: yes') + 'other: ye'.length],
    ['---\ntitle: a #wo\n---\n\nwords\n', '---\ntitle: a #wo\n---\n\nwords\n'.indexOf('#wo') + 3],
  ])('%j', (input, extra) => expect(rowsAt(input, extra)).toBeNull())
})
