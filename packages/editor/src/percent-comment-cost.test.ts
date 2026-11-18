import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { ordenMarkdownExtensions } from './markdown/extensions'

function noteWith(commentLine: string, count = 5000): string {
  const lines: string[] = ['Top words', '', '']
  for (let at = 0; at < count; at++) {
    const place = at % 25
    if (place === 0 || place === 2) lines.push(commentLine)
    else lines.push(at % 5 === 0 ? '' : `line ${at} of the long note`)
  }
  return lines.join('\n')
}

function created(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
  })
}

function fullParseMs(doc: string): number {
  const started = performance.now()
  ensureSyntaxTree(created(doc), doc.length, 60_000)
  return performance.now() - started
}

function typedOnThirdLineMs(doc: string, typed: string): number {
  let state = created(doc)
  ensureSyntaxTree(state, doc.length, 60_000)
  const started = performance.now()
  for (const one of typed) {
    const line = state.doc.line(3)
    state = state.update({ changes: { from: line.to, insert: one } }).state
    ensureSyntaxTree(state, state.doc.length, 60_000)
  }
  return performance.now() - started
}

describe('a 5,000 line note holding 200 %% comment blocks', () => {
  beforeAll(() => {
    fullParseMs(noteWith('xx'))
    fullParseMs(noteWith('%%'))
  }, 60_000)

  test('parses in about the time of the same note without them', { timeout: 60_000 }, () => {
    const plain = fullParseMs(noteWith('xx'))
    const commented = fullParseMs(noteWith('%%'))
    expect(commented).toBeLessThan(plain * 3 + 60)
  })
})

describe('a 10,000 line note holding 400 %% comment blocks', () => {
  test(
    'typing %% on a line near the top reparses the note below quickly',
    { timeout: 60_000 },
    () => {
      fullParseMs(noteWith('xx', 10_000))
      const plain = fullParseMs(noteWith('xx', 10_000))
      expect(typedOnThirdLineMs(noteWith('%%', 10_000), '%%')).toBeLessThan(plain * 4 + 60)
    },
  )
})
