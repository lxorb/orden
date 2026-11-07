import { scanRows } from '@orden/bases/scan'
import { describe, expect, test, vi } from 'vitest'

const held = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  locked: new Set<string>(),
  lists: new Set<string>(),
}))

const notesUnder = (root: string) =>
  [...held.disk]
    .filter(([path]) => path.startsWith(`${root}/`))
    .map(([path, text]) => ({ path: path.slice(root.length + 1), tasks: scanRows(text).tasks }))

vi.mock('../link-index.svelte', () => ({
  links: {
    rootOf: () => '/home',
    scanned: () => Promise.resolve(),
    held: () => notesUnder('/home'),
  },
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: { root: string }) =>
    command === 'scan_links'
      ? Promise.resolve({ notes: notesUnder(args.root), files: [] })
      : Promise.reject(new Error(command)),
}))

vi.mock('../rows/todo-lists', () => ({
  listedAt: (root: string, path: string) => held.lists.has(`${root}/${path}`),
}))

vi.mock('../rows/inbox', () => ({ inboxOf: () => '.Inbox.md' }))

vi.mock('../modes.svelte', () => ({ modes: { undatedInToday: false } }))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    shownSpaces: [
      { root: '/home', name: 'Home' },
      { root: '/work', name: 'Work' },
    ],
    protection: { locked: (path: string) => held.locked.has(path) },
    noteText: (path: string) => Promise.resolve(held.disk.get(path) ?? null),
  },
}))

const { todayHere } = await import('./today-tasks')

describe("the glasses' Today", () => {
  test("lists every shown space's todos due today, as Todos does, and nothing of a shut note", async () => {
    held.disk.set('/home/.Inbox.md', '- [ ] Call Mum 📅 2020-01-01\n')
    held.disk.set('/home/Shop.md', '- [ ] Milk 📅 2020-01-02\n')
    held.disk.set('/home/Diary.md', '- [ ] Only a checkbox 📅 2020-01-01\n')
    held.disk.set('/work/Projects/Launch.md', '- [ ] Send the slides 📅 2020-01-03\n')
    held.disk.set('/work/Secret.md', '- [ ] Hidden plan 📅 2020-01-01\n')
    held.lists.add('/home/Shop.md')
    held.lists.add('/work/Projects/Launch.md')
    held.lists.add('/work/Secret.md')
    held.locked.add('/work/Secret.md')

    const texts = (await todayHere()).map((one) => `${one.space}: ${one.text}`).sort()

    expect(texts).toEqual(['Home: Call Mum', 'Home: Milk', 'Work: Send the slides'])
  })
})
