// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { parseWikilink } from '@orden/markdown/links'
import { afterEach, describe, expect, test } from 'vitest'
import type { LinkSpan } from './at'
import { embedWidget } from './embed'
import { type NoteIndex, noteIndex } from './notes'

const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
const PLAN = '# Plan\n\n- buy milk\n- call the bank ^bank\n  - ask about fees\n- book the trip\n'
const SPACE: NoteIndex = {
  notes: [{ path: 'Plan.md', name: 'Plan', headings: ['Plan'], blocks: ['bank'], aliases: [] }],
  files: [],
  path: 'Today.md',
  read: () => Promise.resolve(PLAN),
  render: (source) => Promise.resolve(source),
}
async function embedded(inner: string): Promise<string> {
  const parsed = parseWikilink(inner, true)
  if (!parsed) throw new Error(`${inner} is not a link`)
  const link: LinkSpan = { ...parsed, kind: 'wikilink', from: 0, to: 0 }
  const view = new EditorView({
    state: EditorState.create({ extensions: [noteIndex.of(SPACE)] }),
    parent: document.body,
  })
  open.push(view)
  const frame = embedWidget(view.state, link).toDOM(view)
  document.body.append(frame)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return frame.querySelector('.orden-embed-body')?.innerHTML ?? ''
}
describe('an embed of a block named on a list item', () => {
  test('shows that item and its children, not the whole list', async () => {
    const shown = await embedded('Plan#^bank')
    expect(shown).toContain('call the bank')
    expect(shown).toContain('ask about fees')
    expect(shown).not.toContain('buy milk')
    expect(shown).not.toContain('book the trip')
  })
})
