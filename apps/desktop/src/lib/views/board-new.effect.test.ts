import { readBase } from '@nib/bases'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** A column's New page whose note was not made (B284): a base in a space shared to be
 *  read, or a folder the account may not write in, answers null rather than throwing.
 *  The title typed is kept in the card, so the reader loses nothing to a refusal.
 *
 *  In the jsdom project because the card is typed into and Enter pressed. */

const made = vi.hoisted((): { path: string | null; titles: string[] } => ({
  path: null,
  titles: [],
}))
vi.mock('./add', () => ({
  addNote: (
    _base: unknown,
    _at: number,
    _file: unknown,
    _group: unknown,
    note: { title: string },
  ) => {
    made.titles.push(note.title)
    return Promise.resolve(made.path)
  },
}))

const BoardNew = (await import('./BoardNew.svelte')).default

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  made.path = null
  made.titles = []
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

function card() {
  const kit = { live: { base: readBase('views:\n  - type: kanban\n'), at: 0 }, file: null }
  const group = { key: 'open', rows: [] }
  const shown = mount(BoardNew, { target, props: { kit, group, property: 'note.status' } as never })
  close = () => void unmount(shown)
  target.querySelector<HTMLButtonElement>('[data-new-page]')?.click()
  flushSync()
  const field = target.querySelector<HTMLInputElement>('input')
  if (!field) throw new Error('no card to type in')
  return field
}

async function enter(field: HTMLInputElement, words: string) {
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(made.titles).toContain(words))
  await new Promise((done) => setTimeout(done, 0))
  flushSync()
}

test('keeps the title typed when the note was not made', async () => {
  const field = card()
  await enter(field, 'Fix the sync')
  expect(target.querySelector<HTMLInputElement>('input')?.value).toBe('Fix the sync')
})

test('and leaves a fresh card once it was', async () => {
  made.path = '/mine/Fix the sync.md'
  const field = card()
  await enter(field, 'Fix the sync')
  expect(target.querySelector<HTMLInputElement>('input')?.value).toBe('')
})
