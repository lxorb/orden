import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(async () => {
  await loadLineCommands()
})

function pressed(mark: string, doc: string, picked: string): string {
  const from = doc.indexOf(picked)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + picked.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  toggleWrap(mark)({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

describe('a mark pressed over lines only some of which hold it, picked inside the marks', () => {
  test('italic over an italic item and a plain item keeps the first item italic, not bold', () => {
    expect(pressed('*', '- *alpha*\n- beta', 'alpha*\n- beta')).toBe('- *alpha*\n- *beta*')
  })

  test('italic over a plain item and an italic item keeps the second item italic, not bold', () => {
    expect(pressed('*', '- alpha\n- *beta*', 'alpha\n- *beta')).toBe('- *alpha*\n- *beta*')
  })

  test('italic over a whole italic item and a whole plain item keeps the first item italic, not bold', () => {
    expect(pressed('*', '- *alpha*\n- beta', '*alpha*\n- beta')).toBe('- *alpha*\n- *beta*')
  })

  test('strikethrough over a struck item and a plain item does not write four tildes', () => {
    expect(pressed('~~', '- ~~alpha~~\n- beta', 'alpha~~\n- beta')).not.toContain('~~~~')
  })
})
