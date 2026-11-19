// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { parseWikilink, sectionOf } from '@orden/markdown/links'
import { afterEach, describe, expect, test } from 'vitest'
import type { LinkSpan } from './at'
import { embedWidget } from './embed'
import { type NoteIndex, noteIndex } from './notes'

const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
const SHOPPING = ['# Shopping', '', '- milk', '- eggs', '- bread', '', '^groceries', ''].join('\n')
const SPACE: NoteIndex = {
  notes: [
    {
      path: 'Shopping.md',
      name: 'Shopping',
      headings: ['Shopping'],
      blocks: ['groceries'],
      aliases: [],
    },
  ],
  files: [],
  path: 'Today.md',
  read: () => Promise.resolve(SHOPPING),
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
describe('an id on its own line under a list names the whole list', () => {
  test('the embed shows every item, not just the last one', async () => {
    const shown = await embedded('Shopping#^groceries')
    expect(shown).toContain('- milk')
    expect(shown).toContain('- eggs')
    expect(shown).toContain('- bread')
  })
  test('the section the hover card and embeds read holds the whole list', () => {
    expect(sectionOf(SHOPPING, { heading: null, block: 'groceries' })).toBe('- milk\n- eggs\n- bread')
    expect(sectionOf('1. one\n2. two\n\n^steps\n', { heading: null, block: 'steps' })).toBe('1. one\n2. two')
    expect(sectionOf('- [ ] call\n  - say hi\n- [ ] write\n\n^todo\n', { heading: null, block: 'todo' })).toBe(
      '- [ ] call\n  - say hi\n- [ ] write',
    )
  })
})
