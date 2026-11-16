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

const PLAN =
  '# Plan\n\n## Goals\nShip the beta by May. ^goal\n\n## Risks\nHiring is slow. ^hiring\n## Budget\nTen thousand.\n'

const SPACE: NoteIndex = {
  notes: [
    {
      path: 'Plan.md',
      name: 'Plan',
      headings: ['Plan', 'Goals', 'Risks', 'Budget'],
      blocks: ['goal', 'hiring'],
      aliases: [],
    },
  ],
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

describe('an embed of a block named on a paragraph written right under its heading', () => {
  test('shows that paragraph, not the heading above it', async () => {
    const shown = await embedded('Plan#^goal')
    expect(shown).toContain('Ship the beta by May.')
    expect(shown).not.toContain('Goals')
  })

  test('shows that paragraph, not the heading written right under it', async () => {
    const shown = await embedded('Plan#^hiring')
    expect(shown).toContain('Hiring is slow.')
    expect(shown).not.toContain('Budget')
  })
})
