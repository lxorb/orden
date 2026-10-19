import { describe, expect, test, vi } from 'vitest'

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

const { heldPapers } = await import('./extract')

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
