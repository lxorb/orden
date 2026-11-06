import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = new Map<string, string>()
const kept = new Map<string, unknown>()

vi.mock('../tauri', () => ({
  isNative: false,
  platform: () => 'linux',
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'read_note') {
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }
    if (command === 'write_note' && typeof args?.content === 'string') disk.set(path, args.content)
    return Promise.resolve('')
  },
}))

vi.mock('../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))
vi.mock('../sync.svelte', () => ({ sync: { nudge: () => undefined } }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../stored', () => ({
  stored: (key: string) => kept.get(key) ?? null,
  keepJson: (key: string, value: unknown) => {
    kept.set(key, value)
    return true
  },
}))

const { dropSetext, SETEXT_GONE } = await import('./setext')
const { FileActions } = await import('./undo.svelte')
type HoldsNotes = import('./note-text').HoldsNotes

const SPACE = '/space'

function space(notes: Record<string, string>): HoldsNotes {
  for (const [path, text] of Object.entries(notes)) disk.set(path, text)
  return {
    activeSpace: { id: 's', name: 'Space', root: SPACE },
    notes: Object.keys(notes).map((path) => ({ path })),
    documents: [],
    documentAt: () => null,
    undone: new FileActions(),
    tags: [],
    flush: () => undefined,
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  } as unknown as HoldsNotes
}

beforeEach(() => {
  disk.clear()
  kept.clear()
})

describe('a space written with underlined headings', () => {
  test('has them written with hashes once, and nothing else touched', async () => {
    const ws = space({
      [`${SPACE}/a.md`]: 'Title\n=====\n\nwords\n\nPart\n----\n',
      [`${SPACE}/b.md`]: '# Already\n\ntext\n\n---\n',
      [`${SPACE}/c.md`]: '```\nnot\n---\n```\n',
    })

    expect(await dropSetext(ws, SPACE, 0)).toBe(1)
    expect(disk.get(`${SPACE}/a.md`)).toBe('# Title\n\nwords\n\n## Part\n')
    expect(disk.get(`${SPACE}/b.md`)).toBe('# Already\n\ntext\n\n---\n')
    expect(disk.get(`${SPACE}/c.md`)).toBe('```\nnot\n---\n```\n')
    expect(kept.get(SETEXT_GONE)).toEqual([SPACE])
    expect(ws.undone.stack).toEqual([])
  })

  test('is not walked again once it has been', async () => {
    const ws = space({ [`${SPACE}/a.md`]: 'Title\n=====\n' })
    kept.set(SETEXT_GONE, [SPACE])

    expect(await dropSetext(ws, SPACE, 0)).toBe(0)
    expect(disk.get(`${SPACE}/a.md`)).toBe('Title\n=====\n')
  })
})
