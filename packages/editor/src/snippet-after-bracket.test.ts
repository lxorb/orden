import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { afterEach, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { setSnippets, snippetCompletions } from './snippets'

function labelsFor(doc: string): string[] {
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const result = snippetCompletions(new CompletionContext(state, doc.length, false))
  return result?.options.map((option) => option.label) ?? []
}

afterEach(() => setSnippets({}))

test('a punctuation trigger typed just inside an opening bracket is offered', () => {
  setSnippets({ ';date': '18 November 2026' })
  expect(labelsFor('Due (;date')).toEqual([';date'])
})

test('a punctuation trigger typed just after an opening quote is offered', () => {
  setSnippets({ ';sig': 'Best wishes,\nAda' })
  expect(labelsFor('She wrote ";sig')).toEqual([';sig'])
})

test('a punctuation trigger typed inside bold is offered', () => {
  setSnippets({ ';sig': 'Best wishes,\nAda' })
  expect(labelsFor('**;sig')).toEqual([';sig'])
})

test('a trigger is not offered at the end of a longer word', () => {
  setSnippets({ ign: 'Ignored', ';sig': 'Best wishes' })
  expect(labelsFor('design')).toEqual([])
  expect(labelsFor('x;sig')).toEqual([])
})
