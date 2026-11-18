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

test('a trigger with an accented letter is offered when typed in full', () => {
  setSnippets({ café: 'Coffee break at ' })
  expect(labelsFor('Meet at café')).toEqual(['café'])
})

test('a trigger that starts with punctuation is offered when typed in full', () => {
  setSnippets({ ';sig': 'Best wishes,\nAda' })
  expect(labelsFor('Thanks ;sig')).toEqual([';sig'])
})
