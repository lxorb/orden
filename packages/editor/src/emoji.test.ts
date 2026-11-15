import { CompletionContext } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { emojiCompletions } from './emoji'
import { ordenMarkdownExtensions } from './markdown/extensions'

async function offered(written: string): Promise<string[]> {
  const caret = written.includes('|') ? written.indexOf('|') : written.length
  const doc = written.replace('|', '')
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const found = await emojiCompletions(new CompletionContext(state, caret, false))
  return (found?.options ?? []).map((option) => option.label)
}

describe('emoji offered while typing', () => {
  test('after a colon that starts a word', async () => {
    expect(await offered('nice :smil')).toContain(':smile:')
    expect(await offered(':smil')).toContain(':smile:')
  })

  test('not in a time or after a word, where a colon is no emoji', async () => {
    expect(await offered('Lunch 12:00')).toEqual([])
    expect(await offered('at 9:30')).toEqual([])
    expect(await offered('color:red')).toEqual([])
  })

  test('not in code', async () => {
    expect(await offered('```py\nx = :smil|\n```\n')).toEqual([])
  })
})
