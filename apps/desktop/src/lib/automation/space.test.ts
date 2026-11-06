import { describe, expect, test, vi } from 'vitest'

const space = { id: 'work', name: 'Work', root: '/Work' }

let open: { path: string | null; doc: string } | null = null
let flushed = 0

const texts: Record<string, string> = { '/Work/notes/Plan.md': '# Plan' }

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [space],
    activeSpace: space,
    activeSpaceId: space.id,
    get active() {
      return open
    },
    flush: () => {
      flushed += 1
    },
    showSpace: () => Promise.resolve(),
    noteText: (path: string) => Promise.resolve(texts[path] ?? null),
  },
}))

vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))

const { noteFor, relativeIn } = await import('./space')

async function refusal(run: Promise<unknown>): Promise<Error> {
  const caught = await run.then(() => null).catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(Error)

  return caught as Error
}

describe('the note on screen', () => {
  test('is the verb’s note, as the space speaks of it', async () => {
    open = { path: '/Work/notes/Plan.md', doc: '# Plan' }
    const before = flushed

    const note = await noteFor({})

    expect(note.relative).toBe('notes/Plan.md')
    expect(note.path).toBe('/Work/notes/Plan.md')
    expect(note.text).toBe('# Plan')
    expect(flushed).toBe(before + 1)
  })

  test('is no note at all when it was opened from outside every space', async () => {
    open = { path: '/Users/me/Downloads/theirs.md', doc: '# somebody else’s' }

    const error = await refusal(noteFor({}))

    expect(error.message).toBe('no note of this space is open, so say which path')
    expect(error.message).not.toContain('Downloads')
  })

  test('and is no note when one climbed back out of the space', async () => {
    open = { path: '/Work/../../etc/passwd', doc: 'root:x:0:0' }

    expect((await refusal(noteFor({}))).message).toBe(
      'no note of this space is open, so say which path',
    )
  })

  test('is not asked for at all when the caller named a path', async () => {
    open = { path: '/Users/me/Downloads/theirs.md', doc: '# somebody else’s' }

    const note = await noteFor({ path: 'notes/Plan.md' })

    expect(note.relative).toBe('notes/Plan.md')
    expect(note.text).toBe('# Plan')
  })
})

describe('a path the caller named', () => {
  test('is refused whole for anything that is not one inside the space', () => {
    expect(() => relativeIn({ path: '../outside.md' })).toThrow(/not a path inside the space/)
    expect(() => relativeIn({ path: 'C:\\Windows\\hosts' })).toThrow(/not a path inside the space/)
    expect(() => relativeIn({})).toThrow(/say which path/)
  })

  test('comes back as the space speaks of it', () => {
    expect(relativeIn({ path: 'notes\\Plan.md' })).toBe('notes/Plan.md')
  })
})
