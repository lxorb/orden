import { expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { html, type HtmlConfig, htmlCompletionSource, htmlGrammar } from './index'

/** The door, cold and then warm.
 *
 *  Cold, `html()` hands back a language whose parser parses nothing and says so, and
 *  asks for the real grammar while it does. Warm, it is the real grammar's own parser.
 *  In an editor that difference is a region left plain and then coloured, because
 *  CodeMirror parses a skipped region again when the parser it was waiting for lands;
 *  the note-sized half of this is packages/editor/src/markdown/html.test.ts.
 *
 *  The tests run in this order for that reason: the grammar is module state, and a
 *  fetch cannot be un-fetched. */

const TAG = '<div class="card">A kestrel <em>hangs</em></div>'

/** Every node a parse of this source produced, by name. Empty for a region the parser
 *  skipped: a skipped region is one node of no type at all, which is anonymous, and an
 *  iteration passes over it. */
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

  // Nothing is offered inside a tag either, rather than an error: the source is asked
  // once, by the tag completion `markdown()` installs, and it is never reached in nib.
  expect(htmlCompletionSource(null as never)).toBeNull()

  // One fetch, kept: a note of twenty tags asks once, and so does a second pane.
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

  // The configuration it was asked for is the configuration the grammar arrives in: a
  // closing tag whose opener is in the paragraph above is not an error in a note, which
  // is what `matchClosingTags: false` says, and it is still said when it lands.
  expect(parsed('</div>', { matchClosingTags: false })).not.toContain('⚠')
})

test('and the support is the close-tag handler and nothing else', () => {
  // Three of the four extensions the real support holds are completion sources nib's
  // popup never asks - it is built with `override`, which is the whole list of sources -
  // and the fourth is what closes a tag. The door carries that one, in the
  // configuration from the start, so the grammar arriving reconfigures nothing.
  const state = EditorState.create({ doc: TAG, extensions: [html().support] })

  expect(state.facet(EditorView.inputHandler)).toHaveLength(1)
  expect(state.facet(EditorState.languageData)).toHaveLength(0)
})
