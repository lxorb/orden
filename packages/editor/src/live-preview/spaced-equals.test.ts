import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { buildDecorations } from './decorate'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const PARK = '\n\nx'
function concealed(doc: string): string[] {
  const full = doc + PARK
  const state = parsed(
    EditorState.create({
      doc: full,
      selection: EditorSelection.cursor(full.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const out: string[] = []
  buildDecorations(state).atomic.between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}
describe('two equals signs with spaces around them', () => {
  const doc = 'if a == b and c == d then stop'
  test('are not read as a highlight by the reading view', () => {
    expect(renderMarkdown(doc)).not.toContain('<mark')
  })
  test('are shown in the editor too, not hidden as highlight marks', () => {
    expect(concealed(doc)).toEqual([])
  })
  test('a highlight written tight still hides its marks', () => {
    expect(concealed('a ==b== c')).toEqual(['==', '=='])
  })
})
