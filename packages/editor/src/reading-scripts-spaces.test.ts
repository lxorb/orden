import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function drawnNodes(doc: string): string[] {
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const names: string[] = []
  syntaxTree(state).iterate({ enter: (node) => void names.push(node.name) })
  return names
}

describe('tildes and carets in everyday prose', () => {
  test('approximate times read the same in the editor and the reading view', () => {
    const words = 'It takes about ~5 min, or ~10 min by bus.'
    expect(drawnNodes(words)).not.toContain('Subscript')
    expect(renderMarkdown(words)).not.toContain('<sub>')
    expect(renderMarkdown(words)).not.toContain('<del>')
  })

  test('home folder paths are not subscript in the reading view', () => {
    const words = 'Files live in ~/notes and ~/work.'
    expect(drawnNodes(words)).not.toContain('Subscript')
    expect(renderMarkdown(words)).not.toContain('<sub>')
  })

  test('powers written with a caret are not superscript across words', () => {
    const words = '2^10 is 1024 and 2^20 is a million.'
    expect(drawnNodes(words)).not.toContain('Superscript')
    expect(renderMarkdown(words)).not.toContain('<sup>')
  })

  test('a word written as subscript still is', () => {
    expect(renderMarkdown('H~2~O and X^2^')).toContain('<sub>2</sub>')
  })
})
