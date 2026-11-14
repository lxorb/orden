import { beforeEach, describe, expect, test, vi } from 'vitest'

const tree = {
  name: 'space',
  path: '/space',
  is_dir: true,
  modified: 0,
  created: 0,
  children: [
    {
      name: 'Lecture.pages',
      path: '/space/Lecture.pages',
      is_dir: false,
      modified: 1,
      created: 0,
      children: [],
    },
    {
      name: 'Lecture.pages.pdf',
      path: '/space/Lecture.pages.pdf',
      is_dir: false,
      modified: 2,
      created: 0,
      children: [],
    },
    {
      name: 'Week',
      path: '/space/Week',
      is_dir: true,
      modified: 0,
      created: 0,
      children: [
        {
          name: 'Optics.pages',
          path: '/space/Week/Optics.pages',
          is_dir: false,
          modified: 3,
          created: 0,
          children: [],
        },
        {
          name: 'Optics.pages.pdf',
          path: '/space/Week/Optics.pages.pdf',
          is_dir: false,
          modified: 4,
          created: 0,
          children: [],
        },
      ],
    },
    {
      name: 'paper.pdf',
      path: '/space/paper.pdf',
      is_dir: false,
      modified: 5,
      created: 0,
      children: [],
    },
  ],
}

const asked: unknown[] = []

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args?: unknown) => {
    asked.push({ command, args })
    return Promise.resolve(command === 'read_tree' ? tree : undefined)
  },
}))

const told = vi.hoisted(() => ({ listed: [] as unknown[][] }))

vi.mock('./papers', () => ({
  paperOpened: () => undefined,
  paperRead: () => undefined,
  papersFor: () => Promise.resolve(),
  papersListed: (...args: unknown[]) => told.listed.push(args),
  writePapers: () => Promise.resolve(),
}))

vi.mock('../../startup.svelte', () => ({ startup: { turn: () => Promise.resolve() } }))

const { heldPapers, readPapers, walkedOf } = await import('./extract')

beforeEach(() => {
  told.listed = []
  asked.length = 0
})

describe('the papers page notes hold', () => {
  test('are read for, though the list leaves them out, for the notes it shows', async () => {
    const listed = [tree.children[0]!, tree.children[2]!.children[0]!, tree.children[3]!]

    const held = await heldPapers('/space', listed)

    expect(held.map((one) => [one.path, one.modified])).toEqual([
      ['/space/Lecture.pages.pdf', 2],
      ['/space/Week/Optics.pages.pdf', 4],
    ])
    expect(asked).toContainEqual({
      command: 'read_tree',
      args: { root: '/space', options: { papers: true } },
    })
  })
})

describe('the page notes the pass reports', () => {
  const listed = [tree.children[0]!, tree.children[2]!.children[0]!, tree.children[3]!]

  test('are the notes of the list, and the folders it read', () => {
    expect(walkedOf('/space', tree)).toEqual({
      notes: ['/space/Lecture.pages', '/space/Week/Optics.pages'],
      folders: ['/space', '/space/Week'],
    })
  })

  test('leave out a folder the list could not read', () => {
    const locked = { ...tree.children[2]!, unlisted: true, children: [] }
    const unread = { ...tree, children: [tree.children[0]!, locked] }

    expect(walkedOf('/space', unread).folders).toEqual(['/space'])
  })

  test('go to papers.ts with the listing', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    await readPapers('/space', listed, tree)
    vi.unstubAllGlobals()

    expect(told.listed.map((one) => one[2])).toEqual([
      walkedOf('/space', tree),
      walkedOf('/space', tree),
    ])
  })

  test('are not said at all where the list could not be read', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    await readPapers('/space', [], null)
    vi.unstubAllGlobals()

    expect(told.listed).toEqual([['/space', new Map(), null]])
  })
})
