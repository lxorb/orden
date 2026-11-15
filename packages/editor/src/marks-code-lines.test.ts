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

function toggled(doc: string, mark: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  toggleWrap(mark)({ state, dispatch: (one: Transaction) => (state = one.state) })
  return state.doc.toString()
}

describe('a mark over several paragraphs that start with inline code', () => {
  test('code toggled on over two paragraphs comes off again', () => {
    const on = toggled('one\n\ntwo', '`')
    expect(on).toBe('`one`\n\n`two`')
    expect(toggled(on, '`')).toBe('one\n\ntwo')
  })

  test('bold goes on a paragraph that starts with a code span', () => {
    expect(toggled('Intro\n\n`npm i` installs it', '**')).toBe(
      '**Intro**\n\n**`npm i` installs it**',
    )
  })
})
