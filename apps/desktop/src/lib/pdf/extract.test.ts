import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The list as the crate answers it asked for every file: two page notes, the paper
 *  each holds, and a PDF of nobody's. */
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

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args?: unknown) => {
    asked.push({ command, args })
    return Promise.resolve(command === 'read_tree' ? tree : undefined)
  },
}))

/** What the pass tells papers.ts, which is all the wiring there is to see. */
const told = vi.hoisted(() => ({ listed: [] as unknown[][] }))

vi.mock('./papers', () => ({
  paperOpened: () => undefined,
  paperRead: () => undefined,
  papersFor: () => Promise.resolve(),
  papersListed: (...args: unknown[]) => told.listed.push(args),
  writePapers: () => Promise.resolve(),
}))

vi.mock('../startup.svelte', () => ({ startup: { turn: () => Promise.resolve() } }))

const { heldPapers, readPapers, walkedOf } = await import('./extract')

beforeEach(() => {
  told.listed = []
  asked.length = 0
})

describe('the papers page notes hold', () => {
  test('are read for, though the list leaves them out, for the notes it shows', async () => {
    // The list as the window has it: the notes, and the paper of nobody's.
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

/** Which page notes a space has is what tells a paper whose note has gone from one
 *  whose folder was never looked in; see `Walked` in papers.ts. */
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

    // Once before the turn and once with the papers the notes hold, the same notes
    // both times.
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
