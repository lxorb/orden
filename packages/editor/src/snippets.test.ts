import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { afterEach, describe, expect, test } from 'vitest'
import type { CompletionContext } from '@codemirror/autocomplete'
import { setSnippets, snippetCompletions } from './snippets'

function completionsFor(doc: string): ReturnType<typeof snippetCompletions> {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [markdown({ base: markdownLanguage })],
  })

  const context = {
    state,
    pos: doc.length,
    explicit: false,
    matchBefore(pattern: RegExp) {
      const line = state.doc.lineAt(doc.length)
      const before = line.text.slice(0, doc.length - line.from)
      const match = new RegExp(`(?:${pattern.source})$`).exec(before)
      if (!match) return null

      return { from: doc.length - match[0].length, to: doc.length, text: match[0] }
    },
  } as unknown as CompletionContext

  return snippetCompletions(context)
}

afterEach(() => setSnippets({}))

describe('snippets', () => {
  test('offers nothing when none are configured', () => {
    expect(completionsFor('tod')).toBeNull()
  })

  test('offers a matching abbreviation', () => {
    setSnippets({ todo: '- [ ] ' })

    const result = completionsFor('tod')
    expect(result?.options).toHaveLength(1)
    expect(result?.options[0]?.label).toBe('todo')
    expect(result?.options[0]?.apply).toBe('- [ ] ')
  })

  test('replaces from the start of the abbreviation', () => {
    setSnippets({ todo: '- [ ] ' })
    expect(completionsFor('text tod')?.from).toBe('text '.length)
  })

  test('ignores a word that matches nothing', () => {
    setSnippets({ todo: '- [ ] ' })
    expect(completionsFor('zzz')).toBeNull()
  })

  test('needs at least two characters', () => {
    setSnippets({ todo: '- [ ] ' })
    expect(completionsFor('t')).toBeNull()
  })

  test('matches without regard to case', () => {
    setSnippets({ Todo: '- [ ] ' })
    expect(completionsFor('tod')?.options).toHaveLength(1)
  })

  test('summarises a multi-line body to one line', () => {
    setSnippets({ note: '> [!NOTE]\n> ' })
    expect(completionsFor('not')?.options[0]?.detail).toBe('> [!NOTE]')
  })
})
