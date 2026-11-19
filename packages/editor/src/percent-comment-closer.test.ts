import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { headingsOf } from '@orden/markdown/links'
import { buildDecorations } from './live-preview/decorate'
import { headings } from './live-preview/toc'
import { trustedMarkup } from './markup'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function stateOf(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), trustedMarkup(false)],
    }),
  )
}

function drawnHeadings(doc: string): string[] {
  const state = stateOf(doc)
  const found: string[] = []
  buildDecorations(state).decorations.between(0, doc.length, (from, _to, value) => {
    const named = (value.spec as { class?: string }).class ?? ''
    if (/\borden-h\d\b/.test(named)) found.push(state.doc.lineAt(from).text)
  })
  return found
}

function fadedText(doc: string): string {
  const state = stateOf(doc)
  let faded = ''
  buildDecorations(state).decorations.between(0, doc.length, (from, to, value) => {
    if (value.spec.class === 'md-meta') faded += doc.slice(from, to)
  })
  return faded
}

const NOTES: Record<string, string> = {
  'a comment opened after words, over paragraphs':
    'Intro. %% draft\n\nSecond draft paragraph.\n\n%%\n\n# Next\n\nCall the bank',
  'a comment opened at the end of a heading': '# Plans %%\nold plan\n%%\n\n# Next\n\nCall the bank',
  'a comment under a paragraph that shows %% as code':
    'Wrap words in `%%` to hide them.\n%%\nold plan\n%%\n\n# Next\n\nCall the bank',
}

describe('the line closing a %% comment opened earlier', () => {
  for (const [name, note] of Object.entries(NOTES)) {
    test(`${name}: the reading view and heading links still show the heading below`, () => {
      expect(renderMarkdown(note)).toContain('<h1>Next</h1>')
      expect(renderMarkdown(note)).toContain('Call the bank')
      expect(headingsOf(note)).toContain('Next')
    })

    test(`${name}: the contents widget lists the heading below`, () => {
      expect(headings(stateOf(note)).map((one) => one.text)).toContain('Next')
    })

    test(`${name}: Live Preview draws the heading below and does not fade the words after it as a comment`, () => {
      expect(fadedText(note)).not.toContain('Call the bank')
      expect(drawnHeadings(note)).toContain('# Next')
    })
  }
})
