import { readBase } from '@nib/bases'
import { describe, expect, test, vi } from 'vitest'
import type { Entry } from '../workspace.svelte'
import { movedWords, orderMoved } from './order-paths'

const notes = new Map<string, string>()

vi.mock('../workspace.svelte', () => ({ workspace: {} }))
vi.mock('../workspace/note-text', () => ({
  noteText: (_: unknown, path: string) => Promise.resolve(notes.get(path) ?? null),
  writeNoteText: (_: unknown, path: string, _before: string, after: string) => {
    notes.set(path, after)
    return Promise.resolve()
  },
}))

function folder(path: string, ...children: Entry[]): Entry {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { name, path, is_dir: true, modified: 0, created: 0, children }
}

function note(path: string): Entry {
  return { ...folder(path), is_dir: false }
}

const BASE = `views:
  - type: kanban
    name: Board
    nib:
      order:
        Doing:
          - Plans/Ship.md
          - Plans/Write.md
`

describe('a board following its cards', () => {
  test('renames a card in a .base file', () => {
    const after = movedWords(BASE, false, 'Plans/Ship.md', 'Plans/Launch.md')
    expect(readBase(after ?? '').views[0]?.nib.order?.Doing).toEqual([
      'Plans/Launch.md',
      'Plans/Write.md',
    ])
  })

  test('and in a database note’s fence, leaving the rest of the note', () => {
    const note = `# Plans\n\n\`\`\`base\n${BASE}\`\`\`\n\nAfter.\n`
    const after = movedWords(note, true, 'Plans', 'Projects') ?? ''
    expect(after.startsWith('# Plans\n\n```base\n')).toBe(true)
    expect(after.endsWith('```\n\nAfter.\n')).toBe(true)
    const body = after.split('```base\n')[1]?.split('```')[0] ?? ''
    expect(readBase(body).views[0]?.nib.order?.Doing).toEqual([
      'Projects/Ship.md',
      'Projects/Write.md',
    ])
  })

  test('and writes nothing where nothing named it', () => {
    expect(movedWords(BASE, false, 'Other.md', 'Else.md')).toBeNull()
  })

  /** A folder renamed carries every database inside it, at any depth, and each one's
   *  board names its cards by the folder's old name. */
  test('and in the databases a renamed folder holds, however deep', async () => {
    const fenced = (dir: string) => `\`\`\`base\n${BASE.replaceAll('Plans/', `${dir}/`)}\`\`\`\n`
    const tree = folder(
      '/s',
      folder(
        '/s/Work',
        folder('/s/Work/Plans', note('/s/Work/Plans/Plans.md'), note('/s/Work/Plans/Ship.md')),
        folder('/s/Work/Old', folder('/s/Work/Old/Deep', note('/s/Work/Old/Deep/Deep.md'))),
      ),
    )
    // Where they are once the folder moved, which is where they are read.
    notes.set('/s/Renamed/Plans/Plans.md', fenced('Work/Plans'))
    notes.set('/s/Renamed/Old/Deep/Deep.md', fenced('Work/Old/Deep'))

    await orderMoved(tree, '/s', '/s/Work', '/s/Renamed')

    expect(notes.get('/s/Renamed/Plans/Plans.md')).toContain('- Renamed/Plans/Ship.md')
    expect(notes.get('/s/Renamed/Old/Deep/Deep.md')).toContain('- Renamed/Old/Deep/Ship.md')
  })
})
