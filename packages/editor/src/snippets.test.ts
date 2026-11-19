import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { afterEach, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { setSnippets, snippetCompletions } from './snippets'

function completionsFor(written: string, explicit = false): ReturnType<typeof snippetCompletions> {
  const caret = written.includes('|') ? written.indexOf('|') : written.length
  const doc = written.replace('|', '')
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  return snippetCompletions(new CompletionContext(state, caret, explicit))
}
const asked = (written: string) => completionsFor(written, true)
afterEach(() => setSnippets({}))
describe('snippets', () => {
  test('offers nothing when none are configured', () => {
    expect(completionsFor('todo')).toBeNull()
    expect(asked('tod')).toBeNull()
  })
  test('offers an abbreviation typed in full', () => {
    setSnippets({ todo: '- [ ] ' })
    const result = completionsFor('todo')
    expect(result?.options).toHaveLength(1)
    expect(result?.options[0]?.label).toBe('todo')
    expect(result?.options[0]?.apply).toBe('- [ ] ')
  })
  test('offers the abbreviations a word begins when asked for completions', () => {
    setSnippets({ todo: '- [ ] ', note: '> [!NOTE]\n> ' })
    expect(asked('tod')?.options.map((option) => option.label)).toEqual(['todo'])
  })
  test('does not offer an abbreviation that an ordinary word only begins while typing', () => {
    setSnippets({ note: '> [!NOTE]\n> ' })
    expect(completionsFor('I said no')).toBeNull()
    expect(completionsFor('tod')).toBeNull()
  })
  test('replaces from the start of the abbreviation', () => {
    setSnippets({ todo: '- [ ] ' })
    expect(completionsFor('text todo')?.from).toBe('text '.length)
    expect(asked('text tod')?.from).toBe('text '.length)
  })
  test('ignores a word that matches nothing', () => {
    setSnippets({ todo: '- [ ] ' })
    expect(asked('zzz')).toBeNull()
  })
  test('needs at least two characters', () => {
    setSnippets({ todo: '- [ ] ' })
    expect(asked('t')).toBeNull()
  })
  test('matches without regard to case', () => {
    setSnippets({ Todo: '- [ ] ' })
    expect(completionsFor('todo')?.options).toHaveLength(1)
    expect(asked('tod')?.options).toHaveLength(1)
  })
  test('is never offered in code', () => {
    setSnippets({ note: '> [!NOTE]\n> ' })
    expect(completionsFor('```py\nnote|\n```\n')).toBeNull()
    expect(asked('```py\nno|\n```\n')).toBeNull()
    expect(completionsFor('run `note|` here\n')).toBeNull()
  })
  test('is never offered in front matter', () => {
    setSnippets({ date: '2026-11-15' })
    expect(completionsFor('---\ntitle: date|\n---\nwords\n')).toBeNull()
    expect(completionsFor('---\ntitle: a\n---\ndate|\n')).not.toBeNull()
  })
  test('summarises a multi-line body to one line', () => {
    setSnippets({ note: '> [!NOTE]\n> ' })
    expect(completionsFor('note')?.options[0]?.detail).toBe('> [!NOTE]')
  })
})
