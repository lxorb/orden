import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  notes: new Map<string, string>(),
  waiting: [] as { id: string; text: string }[],
  left: null as string | null,
  backups: [] as string[],
  kept: new Map<string, string>(),
}))

vi.mock('../native', () => ({
  invoke: (command: string, args: { path?: string; id?: string; content?: string }) => {
    switch (command) {
      case 'shortcuts_added':
        return Promise.resolve(disk.waiting.map((one) => ({ ...one })))
      case 'shortcuts_added_taken':
        disk.waiting = disk.waiting.filter((one) => one.id !== args.id)
        return Promise.resolve()
      case 'shortcuts_left_inbox':
        return Promise.resolve(disk.left)
      case 'spaces_root':
        return Promise.resolve('/Nib')
      case 'read_tree':
        return Promise.resolve({
          children: disk.backups.map((name) => ({
            name,
            path: `/Nib/.orden/.backups/${name}`,
            is_dir: true,
          })),
        })
      case 'read_note': {
        const said = disk.notes.get(args.path ?? '')
        return said === undefined ? Promise.reject(new Error('no note')) : Promise.resolve(said)
      }
      case 'write_note':
        disk.notes.set(args.path ?? '', args.content ?? '')
        return Promise.resolve()
      default:
        return Promise.reject(new Error(`no ${command} here`))
    }
  },
}))

vi.mock('../own-window', () => ({ hearHere: () => Promise.resolve(() => undefined) }))

vi.mock('../internal/spaces', () => ({
  HOME: '.orden',
  keptCameFrom: () => Promise.resolve([{ root: '/Nib/.orden/Notes/Notes', from: '/Nib/Notes' }]),
}))

vi.mock('../internal/roots', () => ({
  mountOf: (path: string) =>
    path === '/Nib/.orden/Notes/Notes'
      ? {
          inside: '',
          mount: {
            folder: {
              name: '/Nib/.orden/Notes',
              readText: (rel: string) => Promise.resolve(disk.kept.get(rel) ?? null),
            },
          },
        }
      : null,
}))

const { takeAdded, tasksSince, TAKEN } = await import('./shortcuts')

const added: string[] = []
const add = (text: string) => {
  added.push(text)
  return Promise.resolve(true)
}

beforeEach(() => {
  disk.notes.clear()
  disk.kept.clear()
  disk.waiting = []
  disk.left = null
  disk.backups = []
  added.length = 0
})

describe('a task from Shortcuts', () => {
  test('goes to the inbox quick add writes to, and is let go only once it is there', async () => {
    disk.waiting = [
      { id: '1-0.txt', text: 'buy milk' },
      { id: '2-0.txt', text: 'call mum' },
    ]
    expect(await takeAdded(add)).toBe(2)
    expect(added).toEqual(['buy milk', 'call mum'])
    expect(disk.waiting).toEqual([])
  })

  test('waits while there is no inbox to write to', async () => {
    disk.waiting = [{ id: '1-0.txt', text: 'buy milk' }]
    expect(await takeAdded(() => Promise.resolve(false))).toBe(0)
    expect(disk.waiting).toHaveLength(1)
  })
})

describe('a task an older build wrote into the folder a space was moved out of', () => {
  const OLD = '/Nib/Notes/.Inbox.md'

  test('is picked up once: only what was written after the move', async () => {
    disk.left = OLD
    disk.backups = ['Notes 20261101 101010', 'Notes 20261105 090000', 'Other 20261106 000000']
    disk.notes.set('/Nib/.orden/.backups/Notes 20261105 090000/.Inbox.md', '- [ ] old\n')
    disk.notes.set(OLD, '- [ ] old\n- [ ] new one\n- [x] done\n')
    disk.kept.set('.Inbox.md', '- [x] old\n')

    expect(await takeAdded(add)).toBe(1)
    expect(added).toEqual(['new one'])
    expect(disk.notes.get(`/Nib/.orden/Notes/${TAKEN}`)).toBe(disk.notes.get(OLD))

    expect(await takeAdded(add)).toBe(0)
    expect(added).toEqual(['new one'])

    disk.notes.set(OLD, `${disk.notes.get(OLD) ?? ''}- [ ] newer\n`)
    expect(await takeAdded(add)).toBe(1)
    expect(added).toEqual(['new one', 'newer'])
  })

  test('without a backup, what the kept space already holds is not added again', async () => {
    disk.left = OLD
    disk.notes.set(OLD, '- [ ] old\n- [ ] new one\n')
    disk.kept.set('.Inbox.md', '- [ ] old\n')
    expect(await takeAdded(add)).toBe(1)
    expect(added).toEqual(['new one'])
  })

  test('is left alone in a folder that is still a space', async () => {
    disk.left = '/Nib/Work/.Inbox.md'
    disk.notes.set('/Nib/Work/.Inbox.md', '- [ ] live\n')
    expect(await takeAdded(add)).toBe(0)
    expect(added).toEqual([])
  })

  test('counts a line written twice as two', () => {
    expect(tasksSince('- [ ] a\n', '- [ ] a\n- [ ] a\n* [ ] b\nnot a task\n')).toEqual(['a', 'b'])
  })
})
