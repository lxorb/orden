import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { nibMarkdownExtensions } from './markdown/extensions'
import { tagCompletions } from './tags'
import { type NoteIndex, noteIndex, type SpaceTag } from './wikilink/notes'

const TAGS: SpaceTag[] = [
  { tag: 'work', notes: 12 },
  { tag: 'work/nib', notes: 7 },
  { tag: 'work/nib/canvas', notes: 2 },
  { tag: 'reading', notes: 4 },
]

function index(tags: readonly SpaceTag[] = TAGS): NoteIndex {
  return { notes: [], files: [], path: null, tags, read: () => Promise.resolve(null) }
}

function state(doc: string, at: number, space = index()): EditorState {
  const built = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at),
    extensions: [
      markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
      noteIndex.of(space),
    ],
  })

  return built.update({}).state
}

/** The rows at a position, which is the end of the document unless it is said. */
function rowsAt(doc: string, at = doc.length, space = index()): CompletionResult | null {
  return tagCompletions(new CompletionContext(state(doc, at, space), at, false))
}

function labels(found: CompletionResult | null): string[] {
  return (found?.options ?? []).map((one) => one.label)
}

describe('a hash in the middle of a line', () => {
  test('offers every tag the space uses, most carried first', () => {
    expect(labels(rowsAt('Filed under #'))).toEqual([
      'work',
      'work/nib',
      'work/nib/canvas',
      'reading',
    ])
  })

  test('says how many notes carry each one', () => {
    expect(rowsAt('Filed under #')?.options.map((one) => one.detail)).toEqual(['12', '7', '2', '4'])
  })

  test('starts the popup past the hash, so a chosen row is the name', () => {
    const found = rowsAt('Filed under #wo')
    expect(found?.from).toBe('Filed under #'.length)
    expect(labels(found)).toEqual(['work', 'work/nib', 'work/nib/canvas'])
  })

  test('narrows to the level under a slash, segment by segment', () => {
    expect(labels(rowsAt('#work/'))).toEqual(['work/nib', 'work/nib/canvas'])
    expect(labels(rowsAt('#work/nib/'))).toEqual(['work/nib/canvas'])
  })

  test('finds a nested one by its last segment alone', () => {
    expect(labels(rowsAt('#canvas'))).toEqual(['work/nib/canvas'])
  })

  test('answers after an opening bracket as well, which is where a tag can sit', () => {
    expect(labels(rowsAt('(#read'))).toEqual(['reading'])
  })

  test('is not a tag in the middle of a word', () => {
    expect(rowsAt('C#')).toBeNull()
    expect(rowsAt('https://nib.dev/#read')).toBeNull()
  })

  test('offers nothing until the app has said what the tags are', () => {
    expect(rowsAt('Filed under #', 13, index([]))).toBeNull()
  })

  test('closes once what is typed is no longer a name', () => {
    expect(rowsAt('#work nib')).toBeNull()
  })
})

describe('a hash that opens a line', () => {
  test('waits for a letter, because `# ` there is a heading', () => {
    expect(rowsAt('#')).toBeNull()
    expect(rowsAt('  #')).toBeNull()
    expect(labels(rowsAt('#w'))).toEqual(['work', 'work/nib', 'work/nib/canvas'])
  })

  test('and is nothing at all once the space after it makes it a heading', () => {
    expect(rowsAt('# ')).toBeNull()
    expect(rowsAt('# Heading')).toBeNull()
  })
})

describe('where the characters are not prose', () => {
  test('not in a fence, where a hash is a comment', () => {
    const fenced = '```py\n# work\n```'
    expect(rowsAt(fenced, fenced.indexOf('# work') + 6)).toBeNull()
  })

  test('not in inline code', () => {
    expect(rowsAt('`#work`', 6)).toBeNull()
  })

  test('not in maths, where a hash is a hash', () => {
    expect(rowsAt('$a #work$', 8)).toBeNull()
  })

  test('not in a link target', () => {
    expect(rowsAt('[a](note.md#work', 16)).toBeNull()
  })
})

describe('the front matter', () => {
  const FRONT = '---\ntags: work\nother: yes\n---\n\nwords\n'

  test('offers the tags under a `tags:` key, with no hash to type', () => {
    const at = FRONT.indexOf('tags: work') + 'tags: wo'.length
    const found = rowsAt(FRONT, at)

    expect(labels(found)).toEqual(['work', 'work/nib', 'work/nib/canvas'])
    // Past the key and its space: what is written is the name alone.
    expect(found?.from).toBe(FRONT.indexOf('tags: work') + 'tags: '.length)
  })

  test('offers them under an item of the list as well', () => {
    const listed = '---\ntags:\n  - work\n  - re\n---\n\nwords\n'
    expect(labels(rowsAt(listed, listed.indexOf('- re') + 4))).toEqual(['reading'])
  })

  test('offers them after a comma in a written-out list', () => {
    const written = '---\ntags: [work, re\n---\n\nwords\n'
    expect(labels(rowsAt(written, written.indexOf('re') + 2))).toEqual(['reading'])
  })

  test('says nothing under any other key', () => {
    const at = FRONT.indexOf('other: yes') + 'other: ye'.length
    expect(rowsAt(FRONT, at)).toBeNull()
  })

  test('and nothing for a hash there, which YAML reads as a comment', () => {
    const hashed = '---\ntitle: a #wo\n---\n\nwords\n'
    expect(rowsAt(hashed, hashed.indexOf('#wo') + 3)).toBeNull()
  })
})
