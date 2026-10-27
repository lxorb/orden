import { answer, readBase } from '@nib/bases'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

/** Q on a card of a task board adds to its column, and a board shown in a view of no
 *  file, as Today can be, may be changed while a task added to it lands in a space
 *  shared to be read, where nothing is kept (B293). There Q opens no quick add.
 *
 *  In the jsdom project because a key is pressed on a mounted board. */

vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))

const { taskRow } = await import('./fixture')
const { kitFor } = await import('./kit')
const { contextFor } = await import('./context')
const { columnsOf } = await import('./columns')
const BoardLayout = (await import('./BoardLayout.svelte')).default

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})

/** A board of one task, whose kit says whether an add has somewhere to land. */
function board(adds: boolean) {
  const base = readBase(`views:
  - type: kanban
    name: Board
    groupBy: { property: task.status, direction: ASC }
    nib: { rows: tasks }
`)
  const rows = [taskRow('Plan.md', '- [ ] water the plants', 3)]
  const context = contextFor({ rows, today: '2026-10-24', now: '2026-10-24T12:00' })
  const live = {
    base,
    at: 0,
    view: base.views[0],
    rows,
    context,
    today: '2026-10-24',
    answer: answer(base, 0, rows, context),
    columns: columnsOf(base, 0, rows),
    writtenAt: null,
    locked: false,
    refused: 0,
    colourOf: () => null,
    change: () => Promise.resolve(),
  }
  const made = kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, null, false)
  const add = vi.fn(() => null)
  const kit = Object.create(made, {
    writable: { value: true },
    adds: { value: adds },
    add: { value: add },
  }) as typeof made
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(BoardLayout, { target, props: { kit } })
  close = () => void unmount(shown)
  flushSync()
  return { target, add }
}

function pressQ(target: HTMLElement) {
  const card = target.querySelector<HTMLElement>('[data-card]')
  if (!card) throw new Error('no card')
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyQ', bubbles: true }))
}

test('Q adds nothing where an add has nowhere to land', () => {
  const { target, add } = board(false)
  pressQ(target)
  expect(add).not.toHaveBeenCalled()
})

test('and adds to the column where it has', () => {
  const { target, add } = board(true)
  pressQ(target)
  expect(add).toHaveBeenCalled()
})
