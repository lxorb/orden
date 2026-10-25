import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Today and Upcoming list the tasks of every space, and two spaces each have their
 *  `Inbox.md` with a task on its first line. Stepping from one to the other (`j`) is a
 *  step to another task: its description and its comment field are its own, and what is
 *  typed there goes into its note and no other (B461). So is a sub-task begun.
 *
 *  In the jsdom project because the sheet is mounted, stepped and typed into. */

const said = vi.hoisted(
  (): { described: [string, string][]; comments: string[]; subtasks: string[] } => ({
    described: [],
    comments: [],
    subtasks: [],
  }),
)
vi.mock('../act', () => ({
  addComment: (_row: unknown, words: string) => {
    said.comments.push(words)
    return Promise.resolve(true)
  },
  deleteComment: () => Promise.resolve(false),
  describe: (path: string, _at: unknown, words: string) => {
    said.described.push([path, words])
    return Promise.resolve(true)
  },
  addSubtask: (row: { space: string }, line: string) => {
    said.subtasks.push(`${row.space}: ${line}`)
    return Promise.resolve(true)
  },
  writeRow: () => Promise.resolve(false),
}))

const NOTES: Record<string, string> = {
  '/work/Inbox.md': '- [ ] Send invoice\n  Work: client ACME, net 30.\n',
  '/home/Inbox.md': '- [ ] Buy milk\n  Two litres.\n',
}
vi.mock('../../workspace/note-text', () => ({
  noteText: (_ws: unknown, path: string) => Promise.resolve(NOTES[path] ?? null),
}))

vi.mock('../../sharing.svelte', () => ({ canWriteAt: () => true }))

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    spaces: [
      { id: 'work', name: 'Work', root: '/work' },
      { id: 'home', name: 'Home', root: '/home' },
    ],
    notes: [],
  },
}))

const { taskRow } = await import('../fixture')
const WORK = taskRow('Inbox.md', '- [ ] Send invoice', 0, { space: 'Work' })
const HOME = taskRow('Inbox.md', '- [ ] Buy milk', 0, { space: 'Home' })

/** How the store answers the sheet: with the rows of the one space asked for, as the
 *  app's does, which the sheet has one pass after the step; or with every space's in
 *  the same pass. The sheet finds its task among them by where it is written, its space
 *  too (rowFor), and may not tell two tasks apart only because its rows of the new
 *  space come one pass late, which is all that hid this in the first. */
const store = vi.hoisted(() => ({ together: false }))
vi.mock('../../rows/rows.svelte', () => ({
  rows: {
    ready: true,
    of: (space?: string) => [WORK, HOME].filter((row) => store.together || row.space === space),
    at: () => [],
    watch: () => () => undefined,
  },
}))

/** CodeMirror measures the text it drew, and jsdom has no layout to measure. Nothing
 *  here asks where anything is. */
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const { EditorView } = await import('@nib/editor')
const { refOf, viewing } = await import('./viewing.svelte')
const TaskView = (await import('./TaskView.svelte')).default

const kit = {
  live: { today: '2026-10-24' },
  writes: () => true,
  open: () => undefined,
  tick: () => Promise.resolve(false),
}

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
  viewing.close()
  said.described = []
  said.comments = []
  said.subtasks = []
  document.body.replaceChildren()
})

/** The sheet of Work's task, over a list of it and Home's, stepped down to Home's. */
async function stepped(before?: () => void) {
  const work = refOf(WORK)
  const home = refOf(HOME)
  if (!work || !home) throw new Error('no task to show')
  viewing.shown = { ref: work, list: [work, home], kit: kit as never }
  const shown = mount(TaskView, { target: document.body })
  close = () => void unmount(shown)
  flushSync()
  await vi.waitFor(() => expect(document.body.textContent).toContain('ACME'))
  before?.()
  viewing.step(1)
  flushSync()
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLInputElement>('input.title')?.value).toBe('Buy milk'),
  )
}

describe.each([
  ['a pass after the step, as the app has them', false],
  ['in the same pass as the step', true],
])('with the rows of the new space %s', (_said, together) => {
  beforeEach(() => {
    store.together = together
  })

  test("a step to another space's task at the same path and line shows that task's description", async () => {
    await stepped()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Two litres.'))
    expect(document.body.textContent).not.toContain('ACME')
  })

  test('and what is typed there is written as its description and no other', async () => {
    await stepped()
    await vi.waitFor(() => expect(document.body.textContent).toContain('Two litres.'))
    const host = document.querySelector<HTMLElement>('.description .cm-editor')
    if (!host) throw new Error('no description to type into')
    const view = EditorView.findFromDOM(host)
    if (!view) throw new Error('no editor')
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' Thanks!' } })
    await vi.waitFor(() => expect(said.described).toHaveLength(1))
    expect(said.described).toEqual([['/home/Inbox.md', 'Two litres. Thanks!']])
  })

  test("a comment begun on one task is not carried to the other space's", async () => {
    await stepped(() => {
      const field = document.querySelector('textarea')
      if (!field) throw new Error('no field to comment in')
      field.value = 'Paid by Friday'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      flushSync()
    })
    expect(document.querySelector('textarea')?.value).toBe('')
  })

  test('nor a sub-task begun', async () => {
    await stepped(() => {
      const adder = [...document.querySelectorAll('button')].find((one) =>
        one.textContent?.includes('Add sub-task'),
      )
      if (!adder) throw new Error('no sub-task to add')
      adder.click()
      flushSync()
      const field = document.querySelector<HTMLInputElement>('input[aria-label="Add sub-task"]')
      if (!field) throw new Error('no field to add a sub-task in')
      field.value = 'Attach the PDF'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      flushSync()
    })
    const field = document.querySelector<HTMLInputElement>('input[aria-label="Add sub-task"]')
    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((done) => setTimeout(done, 20))
    expect(field?.value ?? '').toBe('')
    expect(said.subtasks).toEqual([])
  })
})
