import { expect, test, vi } from 'vitest'

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
orden:
  id: { property: id, prefix: BUG }
`
      : `filters:
  and:
    - file.inFolder("Lit")
orden:
  id: { property: id, prefix: "" }
`,
}))
vi.mock('../rows/rows.svelte', () => ({
  rows: {
    get shown() {
      return this.of
    },
    ready: true,
    of: () => [],
  },
}))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true, trustsHtmlAt: () => true }))
vi.mock('../reminders/platform', () => ({ show: () => undefined }))
vi.mock('../workspace/write-file', () => ({ writeFile: async () => undefined }))

const { readHeld } = await import('./running')
const { EXPERIMENTAL_WORD, BASES_WORD, hiddenKinds } = await import('../settings.svelte')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, BASES_WORD]
const { withoutIds } = await import('./copied')

test("a copy is written without the ids its space's bases number by, and nothing else", async () => {
  await readHeld('/s/Notes/Bugs.base')

  expect(withoutIds('/s/Notes/Bugs/2025/A.md', '---\nid: BUG-2\nstatus: Doing\n---\nText\n')).toBe(
    '---\nstatus: Doing\n---\nText\n',
  )
  expect(withoutIds('/s/Notes/A.md', '---\nid: TASK-2\n---\n')).toBeNull()
  expect(withoutIds('/s/Notes/A.md', '---\nstatus: Doing\n---\n')).toBeNull()
  expect(withoutIds('/s/Other/A.md', '---\nid: BUG-2\n---\n')).toBeNull()
})

test('a copy that lands outside every base keeps its id', async () => {
  await readHeld('/s/Notes/Bugs.base')
  await readHeld('/s/Notes/Reading.base')

  expect(withoutIds('/s/Notes/Archive/A.md', '---\nid: BUG-2\n---\n')).toBeNull()
  expect(withoutIds('/s/Notes/Papers/Smith.md', '---\nid: 2019\n---\n')).toBeNull()
  expect(withoutIds('/s/Notes/Lit/Smith.md', '---\nid: 2019\ntitle: S\n---\n')).toBe(
    '---\ntitle: S\n---\n',
  )
})
