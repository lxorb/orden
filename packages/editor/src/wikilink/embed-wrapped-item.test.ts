// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { parseWikilink } from '@orden/markdown/links'
import { afterEach, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from '../editor'
import { blockTarget } from '../block/commands'
import type { LinkSpan } from './at'
import { embedWidget } from './embed'
import { type NoteIndex, noteIndex } from './notes'

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function named(doc: string, on: string): { text: string; id: string } {
  const view = createEditor({ parent: document.body, doc })
  open.push(view)
  ensureSyntaxTree(view.state, view.state.doc.length, 10_000)
  const target = blockTarget(view, doc.indexOf(on)) ?? ''
  return { text: view.state.doc.toString(), id: target.slice(2) }
}

async function embedded(source: string, id: string): Promise<string> {
  const space: NoteIndex = {
    notes: [{ path: 'Plan.md', name: 'Plan', headings: [], blocks: [id], aliases: [] }],
    files: [],
    path: 'Today.md',
    read: () => Promise.resolve(source),
    render: (section) => Promise.resolve(section),
  }
  const parsed = parseWikilink(`Plan#^${id}`, true)
  if (!parsed) throw new Error('not a link')
  const link: LinkSpan = { ...parsed, kind: 'wikilink', from: 0, to: 0 }
  const view = new EditorView({
    state: EditorState.create({ extensions: [noteIndex.of(space)] }),
    parent: document.body,
  })
  open.push(view)
  const frame = embedWidget(view.state, link).toDOM(view)
  document.body.append(frame)
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  return frame.querySelector('.orden-embed-body')?.innerHTML ?? ''
}

describe('an embed of a list item that runs over two lines, named with Copy link to block', () => {
  test('shows that item, not the whole list', async () => {
    const plan = '- buy milk\n- call the bank\n  about the fees\n- book the trip\n'
    const { text, id } = named(plan, 'call the bank')
    expect(id).not.toBe('')
    const shown = await embedded(text, id)
    expect(shown).toContain('call the bank')
    expect(shown).toContain('about the fees')
    expect(shown).not.toContain('buy milk')
    expect(shown).not.toContain('book the trip')
  })
})
