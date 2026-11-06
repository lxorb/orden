import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { highlightTree } from '@lezer/highlight'
import { describe, expect, test } from 'vitest'
import { nibHighlightStyle, nibTheme } from './theme'

const BOLD = 600

function rulesOf(extension: Extension): string {
  return EditorState.create({ extensions: [extension] })
    .facet(EditorView.styleModule)
    .map((one) => one.getRules())
    .join('\n')
}

function blockFor(rules: string, className: string): string {
  return new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(rules)?.[1] ?? ''
}

function classesOver(doc: string, word: string): string {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  })
  const tree = ensureSyntaxTree(state, doc.length, 5000)
  expect(tree).not.toBeNull()

  const at = doc.indexOf(word)
  let found = ''
  highlightTree(tree!, [nibHighlightStyle], (from, to, classes) => {
    if (from <= at && to >= at + word.length) found = classes
  })

  return found
}

describe('the writing surface', () => {
  test('is as tall as the pane holding it, and scrolls the note inside that', () => {
    const rules = rulesOf(nibTheme)

    expect(rules).toMatch(/\.\S+ \{[^}]*height: 100%/)

    const scroller = /\.\S+ \.cm-scroller \{([^}]*)\}/.exec(rules)?.[1] ?? ''
    expect(scroller).toMatch(/overflow-y: auto/)
  })
})

describe('the words between the stars', () => {
  test('are drawn in a class of their own', () => {
    expect(classesOver('a **bold** word', 'bold')).not.toBe('')
  })

  test('are heavy enough that a browser draws them bold', () => {
    const rules = nibHighlightStyle.module?.getRules() ?? ''
    const [className = ''] = classesOver('a **bold** word', 'bold').split(' ')
    const weight = Number(/font-weight:\s*(\d+)/.exec(blockFor(rules, className))?.[1] ?? 0)

    expect(weight).toBeGreaterThanOrEqual(BOLD)
  })

  test('are heavier than the words around them', () => {
    const rules = nibHighlightStyle.module?.getRules() ?? ''
    const [bold = ''] = classesOver('a **bold** word', 'bold').split(' ')
    const [plain = ''] = classesOver('a *leaning* word', 'leaning').split(' ')

    expect(blockFor(rules, bold).includes('font-weight')).toBe(true)
    expect(blockFor(rules, plain).includes('font-weight')).toBe(false)
  })
})
