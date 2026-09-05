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

  test('an edit always rebuilds', () => {
    const doc = `${PROSE}${TABLE}`
    const before = state(doc, 0)
    const was = before.field(blockDecorations)
    const now = before.update({ changes: { from: 0, insert: 'x' } }).state
    expect(now.field(blockDecorations)).not.toBe(was)
  })
})
