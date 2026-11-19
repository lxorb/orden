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
test('a Hindi trigger is offered when typed in full', () => {
  setSnippets({ नमस्ते: 'नमस्ते, आप कैसे हैं?' })
  expect(labelsFor('मैंने कहा नमस्ते')).toEqual(['नमस्ते'])
})
test('a Thai trigger is offered when typed in full', () => {
  setSnippets({ สวัสดี: 'สวัสดีครับ' })
  expect(labelsFor('พูดว่า สวัสดี')).toEqual(['สวัสดี'])
})
test('a trigger written with a combining accent is offered when typed in full', () => {
  setSnippets({ café: 'Coffee break at ' })
  expect(labelsFor('Meet at café')).toEqual(['café'])
})
