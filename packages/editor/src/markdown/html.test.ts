import { expect, test } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { htmlGrammar } from '@orden/lang-html'
import { ordenMarkdownExtensions } from './extensions'
import { parsed } from '../../test/parsed'

const NOTE = [
  '# A note',
  '',
  '<div class="card">',
  '  <p>A kestrel <em>hangs</em> on the wind.</p>',
  '  <style>.card { color: teal }</style>',
  '  <script>const wind = 12</script>',
  '</div>',
  '',
  'And an inline <u>tag</u> in a paragraph.',
  '',
].join('\n')

function language() {
  return markdown({
    base: markdownLanguage,
    extensions: ordenMarkdownExtensions,
    addKeymap: false,
  })
}

function classes(): Set<string> {
  const found = new Set<string>()

  highlightTree(language().language.parser.parse(NOTE), classHighlighter, (_from, _to, style) => {
    for (const one of style.split(' ')) found.add(one)
  })

  return found
}

test('a note’s HTML is plain until the grammar lands', async () => {
  const cold = classes()
  expect(cold.has('tok-heading')).toBe(true)
  expect(cold.has('tok-typeName')).toBe(false)
  expect(cold.has('tok-propertyName')).toBe(false)
  expect(cold.has('tok-className')).toBe(false)
  expect(cold.has('tok-keyword')).toBe(false)

  const grammar = await htmlGrammar()
  expect(grammar.htmlLanguage.name).toBe('html')
})

test('and coloured once it is here, the same parse over again', async () => {
  await htmlGrammar()

  const warm = classes()

  expect(warm.has('tok-heading')).toBe(true)
  expect(warm.has('tok-typeName')).toBe(true)
  expect(warm.has('tok-propertyName')).toBe(true)
  expect(warm.has('tok-className')).toBe(true)
  expect(warm.has('tok-keyword')).toBe(true)
})

function typed(doc: string, at: number, text: string): string {
  let state = parsed(EditorState.create({ doc, extensions: [language()] }))

  const insert = (): Transaction =>
    state.update({
      changes: { from: at, to: at, insert: text },
      selection: { anchor: at + text.length },
    })

  const view = {
    composing: false,
    get state() {
      return state
    },
    dispatch: (specs: readonly Transaction[]) => {
      for (const one of specs) state = one.state
    },
  } as unknown as EditorView

  const press = () => {
    for (const handle of state.facet(EditorView.inputHandler)) {
      if (handle(view, at, at, text, insert)) return true
    }
    return false
  }

  for (let asked = 0; asked < ASKED_AT_MOST; asked++) {
    if (press()) break
  }

  return state.doc.toString()
}

const ASKED_AT_MOST = 20

test('and a tag typed inside a raw block still closes itself', async () => {
  await htmlGrammar()

  const block = '# Typing\n\n<div>\n  <p>Wind</p><em\n'
  expect(typed(block, block.indexOf('<em') + 3, '>')).toBe(
    '# Typing\n\n<div>\n  <p>Wind</p><em></em>\n',
  )

  const prose = '# Typing\n\nplain text\n'
  expect(typed(prose, prose.length - 1, '>')).toBe(prose)
})
