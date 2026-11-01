import { readBase } from '@orden/bases'
import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What the form keeps when Send makes nothing: a note refused, as one in a space
 *  shared to be read is, leaves what was typed where it was typed. */

const made = vi.hoisted(() => ({ titles: [] as string[] }))
vi.mock('../../src/lib/views/add', () => ({
  addNote: (
    _base: unknown,
    _at: number,
    _file: unknown,
    _group: unknown,
    note: { title: string },
  ) => {
    made.titles.push(note.title)
    return Promise.resolve(null)
  },
}))

const FormLayout = (await import('../../src/lib/views/FormLayout.svelte')).default

const base = readBase('views:\n  - type: form\n')

function shown(adds: boolean) {
  const target = document.createElement('div')
  document.body.append(target)
  const kit = {
    live: { base, at: 0, view: base.views[0], columns: [], rows: [] },
    file: null,
    adds,
  }
  const form = mount(FormLayout, { target, props: { kit } as never })
  const title = target.querySelector<HTMLInputElement>('input')
  if (!title) throw new Error('no title field')
  title.value = 'Fix the sync'
  title.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  target
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  return { title, done: () => void unmount(form) }
}

beforeEach(() => {
  made.titles.length = 0
})

describe('the form, when Send makes no note', () => {
  test('keeps the name that was typed', async () => {
    const { title, done } = shown(true)
    await vi.waitFor(() => expect(made.titles).toEqual(['Fix the sync']))
    await new Promise((settled) => setTimeout(settled, 0))
    flushSync()
    expect(title.value).toBe('Fix the sync')
    done()
  })

  test('sends nothing where the note would land in a space shared to be read', async () => {
    const { title, done } = shown(false)
    await new Promise((settled) => setTimeout(settled, 0))
    flushSync()
    expect(made.titles).toEqual([])
    expect(title.value).toBe('Fix the sync')
    done()
  })
})
