import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { copiedFlavours, readyToCopy } from './copy'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(() => readyToCopy())
function copiedHtml(doc: string, from: string, to: string): string {
  const start = doc.indexOf(from)
  const end = doc.indexOf(to, start) + to.length
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(start, end),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  return copiedFlavours(state)?.html ?? ''
}
describe('words copied from inside a bold, code or link run to the words after it', () => {
  test('the HTML flavour shows no stray closing stars', () => {
    const html = copiedHtml('This is **very important** stuff.', 'important', 'stuff.')
    expect(html).toContain('important')
    expect(html).not.toContain('**')
  })
  test('the HTML flavour shows no stray backtick', () => {
    const html = copiedHtml('Run `npm install` now.', 'install', 'now.')
    expect(html).toContain('install')
    expect(html).not.toContain('`')
  })
  test('the HTML flavour shows no stray link address', () => {
    const html = copiedHtml('See [the plan](https://x.test/plan) today.', 'plan', 'today.')
    expect(html).toContain('plan')
    expect(html).not.toContain('](')
  })
})
