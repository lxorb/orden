import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { blockDecorations } from './blocks'
import { nibMarkdownExtensions } from '../markdown/extensions'

function state(doc: string, cursor = 0) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }),
      blockDecorations,
    ],
  })
}

/** Moving the caret to `to` from `from`, and what the field did about it. */
function afterMove(doc: string, from: number, to: number) {
  const before = state(doc, from)
  const was = before.field(blockDecorations)
  const now = before.update({ selection: EditorSelection.cursor(to) }).state
  return { was, is: now.field(blockDecorations) }
}

/** Where the field found something, as text. */
function spans(doc: string, cursor = 0): string[] {
  return state(doc, cursor).field(blockDecorations).spans.map((span) => doc.slice(span.from, span.to))
}

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |'
const PROSE = 'one **two** three [four](five) `six`\n\nseven eight nine\n\n'

describe('block decorations', () => {
  test('records where the constructs that mind the caret are', () => {
    expect(spans(`${PROSE}${TABLE}`)).toEqual([TABLE])
    expect(spans('$$\nx = 1\n$$')).toEqual(['$$\nx = 1\n$$'])
    expect(spans('```mermaid\ngraph TD\n```')).toEqual(['```mermaid\ngraph TD\n```'])
    expect(spans('[toc]')).toEqual(['[toc]'])
  })

  test('prose and plain fences are not places the caret changes anything', () => {
    expect(spans(`${PROSE}\`\`\`js\nlet x = 1\n\`\`\``)).toEqual([])
  })

  test('a caret that stays clear of them all rebuilds nothing', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, 0, 20)
    expect(is).toBe(was)
  })

  test('a caret arriving in one of them rebuilds', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, 0, doc.length - 2)
    expect(is).not.toBe(was)
    expect(is.decorations.size).toBe(0)
  })

  test('a caret leaving one of them rebuilds', () => {
    const doc = `${PROSE}${TABLE}`
    const { was, is } = afterMove(doc, doc.length - 2, 0)
    expect(is).not.toBe(was)
    expect(is.decorations.size).toBe(1)
  })

})

/** What the field made of typing `insert` at `at`, and what it had before. */
function afterTyping(doc: string, at: number, insert: string, to = at) {
  const before = state(doc, at)
  const was = before.field(blockDecorations)
  const now = before.update({
    changes: { from: at, to, insert },
    selection: { anchor: at + insert.length },
  }).state
  return { was, is: now.field(blockDecorations), state: now }
}

/** Where the field says a construct is, as text of the state it belongs to. */
function drawn(blocks: { decorations: { between: unknown } }, doc: string): string[] {
  const out: string[] = []
  ;(blocks.decorations as import('@codemirror/view').DecorationSet).between(
    0,
    doc.length,
    (from, to) => {
      out.push(doc.slice(from, to))
    },
  )
  return out
}

describe('prose typed away from every construct', () => {
  const doc = `${PROSE}${TABLE}`

  test('moves the constructs along without looking for them again', () => {
    const { was, is, state: after } = afterTyping(doc, 4, 'word')
    expect(is.spans).not.toBe(was.spans)
    expect(drawn(is, after.doc.toString())).toEqual([TABLE])
  })

  test('a line break is not prose: it is looked at properly', () => {
    const { was, is } = afterTyping(doc, 4, '\n')
    expect(is.spans).not.toEqual(was.spans)
    expect(is.decorations.size).toBe(1)
  })

  test('a bar could make a table row, so it is looked at properly', () => {
    const found = afterTyping(`${PROSE}| a | b |\n| - | - |\n`, 0, '| c |\n')
    expect(found.is.decorations.size).toBe(1)
  })

  test('a construct typed into is rebuilt, not shifted', () => {
    const at = doc.length - 2
    const { is } = afterTyping(doc, at, 'z')
    expect(is.decorations.size).toBe(0)
  })

  test('dollars are not prose either', () => {
    // An unclosed `$$` runs to the end of the note; closing it has to shorten
    // the equation, which only looking again can do.
    const opened = `${PROSE}$$\nx\n\nmore prose after it\n`
    const at = opened.indexOf('\n\nmore')
    const { was, is } = afterTyping(opened, at + 1, '$$\n')
    expect(was.spans[0].to).toBe(opened.length)
    expect(is.spans[0].to).toBe(at + 3)
  })

  test('a note with a toc is always looked at again: a heading elsewhere changes it', () => {
    const withToc = `[toc]\n\n# One\n\nsome prose here\n`
    const at = withToc.indexOf('# One') + 2
    const { is, state: after } = afterTyping(withToc, at, 'Two ')
    expect(drawn(is, after.doc.toString())).toEqual(['[toc]'])
  })

  test('deleting prose shifts the constructs too', () => {
    const { is, state: after } = afterTyping(doc, 4, '', 8)
    expect(drawn(is, after.doc.toString())).toEqual([TABLE])
  })
})
