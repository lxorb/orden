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

const PLAN = [
  '# Plan',
  '',
  '## Prices',
  '| Item | Cost |',
  '| --- | --- |',
  '| Desk | 120 |',
  '',
  '^prices',
  '',
  '## Setup',
  '```sh',
  'npm install',
  '```',
  '',
  '^setup',
  '',
  '## Snippet',
  '',
  '```js',
  'run()',
  '```',
  '^snippet',
  '',
  '## Older',
  '',
  '```py',
  'print(1)',
  '',
  'print(2)',
  '``` ^older',
  '',
].join('\n')

const SPACE: NoteIndex = {
  notes: [
    {
      path: 'Plan.md',
      name: 'Plan',
      headings: ['Plan', 'Prices', 'Setup', 'Snippet', 'Older'],
      blocks: ['prices', 'setup', 'snippet', 'older'],
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

describe('a block named on its own line under a table or fence written right under its heading', () => {
  test('a table embed shows the table, not the heading above it', async () => {
    const shown = await embedded('Plan#^prices')
    expect(shown).toContain('| Desk | 120 |')
    expect(shown).not.toContain('Prices')
  })

  test('a code embed shows the code, not the heading above it', async () => {
    const shown = await embedded('Plan#^setup')
    expect(shown).toContain('npm install')
    expect(shown).not.toContain('Setup')
  })
})

describe('a block named on the line right under a closing fence', () => {
  test('the embed shows the code above it', async () => {
    const shown = await embedded('Plan#^snippet')
    expect(shown).toContain('run()')
  })

  test('a code embed named on its closing fence by an older build shows the code', async () => {
    const shown = await embedded('Plan#^older')
    expect(shown).toContain('print(1)')
    expect(shown).toContain('print(2)')
  })
})
