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

test('a punctuation trigger typed right after Chinese words is offered', () => {
  setSnippets({ ';sig': '此致，王伟' })
  expect(labelsFor('谢谢你的帮助;sig')).toEqual([';sig'])
})

test('a punctuation trigger typed right after Japanese words is offered', () => {
  setSnippets({ ';date': '2026年11月18日' })
  expect(labelsFor('締め切りは;date')).toEqual([';date'])
})

test('a Thai trigger typed in a sentence written without spaces is offered', () => {
  setSnippets({ สวัสดี: 'สวัสดีครับ' })
  expect(labelsFor('พูดว่าสวัสดี')).toEqual(['สวัสดี'])
})
