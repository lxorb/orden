import type { Entry } from '@orden/contracts'
import { readBase } from '@orden/bases'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { movedWords, orderMoved } from './order-paths'

const notes = new Map<string, string>()
const holding: string[] = []
const read: string[] = []

vi.mock('../../link-index/src/api', () => ({
  links: { basesIn: (root: string) => (root === '/s' ? holding : []) },
}))

vi.mock('../../workspace/src/api', () => ({
  workspace: {},
  noteText: (_: unknown, path: string) => {
    read.push(path)
    return Promise.resolve(notes.get(path) ?? null)
  },
  writeNoteText: (_: unknown, path: string, _before: string, after: string) => {
    notes.set(path, after)
    return Promise.resolve()
  },
}))

function folder(path: string, ...children: Entry[]): Entry {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { name, path, is_dir: true, modified: 0, created: 0, children }
}

const note = (path: string): Entry => ({ ...folder(path), is_dir: false })
const BASE = `views:
  - type: kanban
    name: Board
    orden:
      order:
        Doing:
          - Plans/Ship.md
          - Plans/Write.md
`

beforeEach(() => {
  notes.clear()
  holding.length = 0
  read.length = 0
})

describe('a board following its cards', () => {
  test('renames a card in a .base file', () => {
    const after = movedWords(BASE, false, 'Plans/Ship.md', 'Plans/Launch.md')
    expect(readBase(after ?? '').views[0]?.orden.order?.Doing).toEqual(['Plans/Launch.md', 'Plans/Write.md'])
  })

  test('and in a database note’s fence, leaving the rest of the note', () => {
    const note = `# Plans\n\n\`\`\`base\n${BASE}\`\`\`\n\nAfter.\n`
    const after = movedWords(note, true, 'Plans', 'Projects') ?? ''
    expect(after.startsWith('# Plans\n\n```base\n')).toBe(true)
    expect(after.endsWith('```\n\nAfter.\n')).toBe(true)
    const body = after.split('```base\n')[1]?.split('```')[0] ?? ''
    expect(readBase(body).views[0]?.orden.order?.Doing).toEqual(['Projects/Ship.md', 'Projects/Write.md'])
  })

  test('and writes nothing where nothing named it', () => {
    expect(movedWords(BASE, false, 'Other.md', 'Else.md')).toBeNull()
  })

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
    notes.set('/s/Renamed/Plans/Plans.md', fenced('Work/Plans'))
    notes.set('/s/Renamed/Old/Deep/Deep.md', fenced('Work/Old/Deep'))
    holding.push('/s/Work/Plans/Plans.md', '/s/Work/Old/Deep/Deep.md')

    await orderMoved(tree, '/s', '/s/Work', '/s/Renamed')

    expect(notes.get('/s/Renamed/Plans/Plans.md')).toContain('- Renamed/Plans/Ship.md')
    expect(notes.get('/s/Renamed/Old/Deep/Deep.md')).toContain('- Renamed/Old/Deep/Ship.md')
  })

  test('and the same where the tree already shows the folder moved', async () => {
    const fenced = (dir: string) => `\`\`\`base\n${BASE.replaceAll('Plans/', `${dir}/`)}\`\`\`\n`
    const tree = folder(
      '/s',
      folder(
        '/s/Renamed',
        folder('/s/Renamed/Plans', note('/s/Renamed/Plans/Plans.md'), note('/s/Renamed/Plans/Ship.md')),
      ),
    )
    notes.set('/s/Renamed/Plans/Plans.md', fenced('Work/Plans'))
    holding.push('/s/Renamed/Plans/Plans.md')

    await orderMoved(tree, '/s', '/s/Work', '/s/Renamed')

    expect(notes.get('/s/Renamed/Plans/Plans.md')).toContain('- Renamed/Plans/Ship.md')
  })

  test('and in a database written in any other note, reading only the notes that hold one', async () => {
    const tree = folder(
      '/s',
      note('/s/Dashboard.md'),
      note('/s/Diary.md'),
      folder('/s/Plans', note('/s/Plans/Ship.md'), note('/s/Plans/Write.md')),
      folder('/s/Done'),
    )
    notes.set('/s/Dashboard.md', `# Dashboard\n\n\`\`\`base\n${BASE}\`\`\`\n`)
    notes.set('/s/Diary.md', 'Shipped Plans/Ship.md today.\n')
    holding.push('/s/Dashboard.md')

    await orderMoved(tree, '/s', '/s/Plans/Ship.md', '/s/Done/Ship.md')

    expect(notes.get('/s/Dashboard.md')).toContain('- Done/Ship.md')
    expect(notes.get('/s/Dashboard.md')).toContain('- Plans/Write.md')
    expect(read).toEqual(['/s/Dashboard.md'])
  })
})
