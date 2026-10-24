import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** A task's comments and description where the note may not be written (B285): in a
 *  space shared with this account to be read the sheet offers neither, and a comment
 *  the store still turns away stays in its field rather than being lost.
 *
 *  In the jsdom project because a field is typed into and the editor mounted. */

const said = vi.hoisted((): { ok: boolean; comments: string[] } => ({ ok: false, comments: [] }))
vi.mock('../act', () => ({
  addComment: (_row: unknown, words: string) => {
    said.comments.push(words)
    return Promise.resolve(said.ok)
  },
  deleteComment: () => Promise.resolve(false),
  describe: () => Promise.resolve(false),
}))
vi.mock('../../workspace/note-text', () => ({
  noteText: () =>
    Promise.resolve(
      '- [ ] water the plants\n  Twice a week.\n  - Done Monday [at:: 2026-10-20T09:00]\n',
    ),
}))

/** CodeMirror measures the text it drew, and jsdom has no layout to measure. Nothing
 *  here asks where anything is. */
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const { taskRow } = await import('../fixture')
const Comments = (await import('./Comments.svelte')).default
const Description = (await import('./Description.svelte')).default

const row = taskRow('Plan.md', '- [ ] water the plants', 0)
const path = '/theirs/Plan.md'

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  said.ok = false
  said.comments = []
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

function comments(writable: boolean) {
  const shown = mount(Comments, { target, props: { row, path, writable } })
  close = () => void unmount(shown)
  flushSync()
}

async function send(words: string) {
  const field = target.querySelector('textarea')
  if (!field) throw new Error('no field to comment in')
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(said.comments).toContain(words))
  await new Promise((done) => setTimeout(done, 0))
  flushSync()
  return field
}

test('a comment turned away stays in its field', async () => {
  comments(true)
  const field = await send('Rain tomorrow')
  expect(field.value).toBe('Rain tomorrow')
})

test('and one written leaves it empty', async () => {
  said.ok = true
  comments(true)
  const field = await send('Rain tomorrow')
  expect(field.value).toBe('')
})

test('a task that may not be written has no field to comment in, nor a delete', async () => {
  comments(false)
  await vi.waitFor(() => expect(target.textContent).toContain('Done Monday'))
  expect(target.querySelector('textarea')).toBeNull()
  expect(target.querySelector('button')).toBeNull()
})

test('nor a description to type into', async () => {
  const shown = mount(Description, {
    target,
    props: { path, anchor: () => ({ line: 0, hash: row.anchor?.hash ?? '' }), writable: false },
  })
  close = () => void unmount(shown)
  await vi.waitFor(() => expect(target.querySelector('.cm-content')).not.toBeNull())
  expect(target.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
})
