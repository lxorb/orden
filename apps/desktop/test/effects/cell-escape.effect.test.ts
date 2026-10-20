/** Escape out of a table cell's editor, and where the keyboard is after it.
 *
 *  Found in the #419 bug hunt (#523): the control the cell was being written in went,
 *  and the keyboard went with it to the page's `body`, so the arrows that walk the
 *  table walked nothing. It goes back to the cell the control was in.
 *
 *  In the jsdom project because focus needs a document and the table is mounted. */

import { answer, readBase, type Row } from '@nib/bases'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/rooms.svelte', () => ({ rooms: { present: {}, following: null } }))

class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

const { contextFor } = await import('../../src/lib/views/context')
const { columnsOf } = await import('../../src/lib/views/columns')
const { taskRow } = await import('../../src/lib/views/fixture')
const { kitFor } = await import('../../src/lib/views/kit')
const TableLayout = (await import('../../src/lib/views/TableLayout.svelte')).default

const TODAY = '2026-10-04'
const BASE = readBase('views:\n  - type: table\n    order: [task.text]\n    nib: { rows: tasks }\n')

let shown: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.replaceChildren()
})

/** The table over these rows, as LiveView would hold it; see views/layouts.test.ts. */
function table(rows: readonly Row[]) {
  const context = contextFor({ rows, today: TODAY, now: `${TODAY}T10:00:00` })
  const live = {
    base: BASE,
    at: 0,
    view: BASE.views[0] ?? null,
    rows,
    context,
    today: TODAY,
    answer: answer(BASE, 0, rows, context),
    columns: columnsOf(BASE, 0, rows),
    colourOf: () => null,
  }
  const kit = kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, null, false)
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(TableLayout, { target, props: { kit } })
  flushSync()

  return target
}

test('Escape out of a cell being written in leaves the keyboard on the cell', async () => {
  const target = table([taskRow('Errands.md', '- [ ] Call the bank', 2)])
  const cell = target.querySelector<HTMLElement>('[role="gridcell"]')
  cell?.click()
  flushSync()
  cell?.click()
  flushSync()

  const field = target.querySelector<HTMLInputElement>('input.edit')
  expect(document.activeElement).toBe(field)

  field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
  await tick()

  expect(target.querySelector('input.edit')).toBeNull()
  expect(document.activeElement).toBe(cell)
})
