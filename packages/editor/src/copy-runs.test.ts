import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { copiedFlavours, readyToCopy } from './copy'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(() => readyToCopy())

function copied(doc: string, from: string, to: string): { text: string; html: string } {
  const start = doc.indexOf(from)
  const end = doc.indexOf(to, start) + to.length
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(start, end),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const flavours = copiedFlavours(state)
  return { text: flavours?.text ?? '', html: flavours?.html ?? '' }
}

describe('words copied from inside a wiki link to the words after it', () => {
  test('the HTML flavour shows no stray closing brackets', () => {
    const { html } = copied('See [[Project plan]] and more.', 'plan', 'more.')
    expect(html).toContain('plan')
    expect(html).not.toContain(']]')
  })

  test('the HTML flavour shows no stray opening brackets when the pick ends inside the link', () => {
    const { html } = copied('Before and [[Project plan]] after.', 'Before', 'Project')
    expect(html).toContain('Project')
    expect(html).not.toContain('[[')
  })
})

describe('a link address copied with the parenthesis that closes it', () => {
  test('the HTML flavour holds the address that was picked, not the link words left out', () => {
    const { text, html } = copied('See [the plan](https://x.test/plan) today.', 'https', 'today.')
    expect(text).toBe('https://x.test/plan) today.')
    expect(html).toContain('x.test/plan')
    expect(html).not.toContain('the plan')
  })

  test('picking the address in its parentheses does not copy the link words instead', () => {
    const { html } = copied('See [the plan](https://x.test/plan) today.', '(https', 'plan)')
    expect(html).not.toContain('the plan')
  })
})
