import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { insertToc } from './commands'
import { blockDecorations } from './live-preview/blocks'
import { dragFreeze } from './live-preview/dragging'
import { ordenMarkdownExtensions } from './markdown/extensions'

function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
      ],
    }),
  )
}
function inserted(doc: string, at: number): string {
  const state = stateOf(doc, at)
  let next = state
  insertToc({ state, dispatch: (one: Transaction) => (next = one.state) })
  return next.doc.toString()
}
function drawnContents(doc: string): boolean {
  return stateOf(doc, doc.length)
    .field(blockDecorations)
    .spans.some((span) => doc.slice(span.from, span.to) === '[toc]')
}
describe('Insert table of contents on the line under a paragraph', () => {
  test('is drawn when the contents block stands as its own paragraph', () => {
    expect(drawnContents('# Plan\n\nWords.\n\n[toc]\n\n## Goals\n')).toBe(true)
  })
  test('from the end of the paragraph writes a contents block that is drawn', () => {
    const doc = '# Plan\n\nWhat this note covers.\n\n## Goals\n\n## Risks\n'
    const written = inserted(doc, doc.indexOf('covers.') + 'covers.'.length)
    expect(drawnContents(written)).toBe(true)
  })
  test('from the blank line under the paragraph, as the slash menu is used', () => {
    const above = '# Plan\n\nWhat this note covers.\n'
    const written = inserted(`${above}\n## Goals\n\n## Risks\n`, above.length)
    expect(drawnContents(written)).toBe(true)
  })
})
