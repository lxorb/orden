import { expect, test, vi } from 'vitest'

/** A copy's words without the ids of the bases of its space (B552): the copy then gets
 *  the next from the runner, and the note it was copied from keeps its own. */

vi.mock('../workspace.svelte', () => ({
  workspace: { spaces: [{ id: 'notes', name: 'Notes', root: '/s/Notes' }] },
}))
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: async (_command: string, args: { path: string }) =>
    args.path.endsWith('Bugs.base')
      ? `filters:
  and:
    - file.inFolder("Bugs")
nib:
  id: { property: id, prefix: BUG }
`
      : `filters:
  and:
    - file.inFolder("Lit")
nib:
  id: { property: id, prefix: "" }
`,
}))
vi.mock('../rows/rows.svelte', () => ({ rows: { ready: true, of: () => [] } }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../reminders/platform', () => ({ show: () => undefined }))
vi.mock('../workspace/write-file', () => ({ writeFile: async () => undefined }))

const { readHeld } = await import('./running')
const { withoutIds } = await import('./copied')

test("a copy is written without the ids its space's bases number by, and nothing else", async () => {
  await readHeld('/s/Notes/Bugs.base')

  expect(withoutIds('/s/Notes/Bugs/2025/A.md', '---\nid: BUG-2\nstatus: Doing\n---\nText\n')).toBe(
    '---\nstatus: Doing\n---\nText\n',
  )
  // Another prefix's id, a note without one, and a note in another space keep theirs.
  expect(withoutIds('/s/Notes/A.md', '---\nid: TASK-2\n---\n')).toBeNull()
  expect(withoutIds('/s/Notes/A.md', '---\nstatus: Doing\n---\n')).toBeNull()
  expect(withoutIds('/s/Other/A.md', '---\nid: BUG-2\n---\n')).toBeNull()
})

test('a copy that lands outside every base keeps its id', async () => {
  await readHeld('/s/Notes/Bugs.base')
  await readHeld('/s/Notes/Reading.base')

  // Into a folder the numbering base does not cover.
  expect(withoutIds('/s/Notes/Archive/A.md', '---\nid: BUG-2\n---\n')).toBeNull()
  // A base without a prefix reads any number as one of its ids, but only its own rows.
  expect(withoutIds('/s/Notes/Papers/Smith.md', '---\nid: 2019\n---\n')).toBeNull()
  expect(withoutIds('/s/Notes/Lit/Smith.md', '---\nid: 2019\ntitle: S\n---\n')).toBe(
    '---\ntitle: S\n---\n',
  )
})
