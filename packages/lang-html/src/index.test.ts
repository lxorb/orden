import { expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { html, type HtmlConfig, htmlCompletionSource, htmlGrammar } from './index'

const TAG = '<div class="card">A kestrel <em>hangs</em></div>'

function parsed(source: string, config: HtmlConfig = {}): string[] {
  const found: string[] = []

  html(config)
    .language.parser.parse(source)
    .iterate({
      enter: (node) => {
        found.push(node.name)
      },
    })

  return found
}

test('a parse before the grammar is here parses nothing, and asks for it', async () => {
  const cold = html({ matchClosingTags: false })

  expect(cold.language.name).toBe('html')
  expect(parsed(TAG, { matchClosingTags: false })).toEqual([])

  expect(htmlCompletionSource(null as never)).toBeNull()

  expect(htmlGrammar()).toBe(htmlGrammar())

  const grammar = await htmlGrammar()
  expect(grammar.htmlLanguage.name).toBe('html')
  expect(await htmlGrammar()).toBe(grammar)
})

test('and once it is here the same language parses it for real', () => {
  const found = parsed(TAG, { matchClosingTags: false })

  expect(found).toContain('Element')
  expect(found).toContain('TagName')
  expect(html({ matchClosingTags: false }).language.parser.parse(TAG).length).toBe(TAG.length)

  expect(parsed('</div>', { matchClosingTags: false })).not.toContain('⚠')
})

test('and the support is the close-tag handler and nothing else', () => {
  const state = EditorState.create({ doc: TAG, extensions: [html().support] })

  expect(state.facet(EditorView.inputHandler)).toHaveLength(1)
  expect(state.facet(EditorState.languageData)).toHaveLength(0)
})
