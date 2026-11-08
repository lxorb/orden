import { answer, readBase, type Row } from '@orden/bases'
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/rooms.svelte', () => ({ rooms: { present: {}, following: null } }))

const { contextFor } = await import('../../src/lib/views/context')
const { columnsOf } = await import('../../src/lib/views/columns')
const { taskRow } = await import('../../src/lib/views/fixture')
const { kitFor } = await import('../../src/lib/views/kit')
const TableLayout = (await import('../../src/lib/views/TableLayout.svelte')).default
const ViewHead = (await import('../../src/lib/views/ViewHead.svelte')).default

const TODAY = '2026-10-04'
const BASE = readBase(
  'views:\n  - type: table\n    name: Week\n    order: [task.text]\n    orden: { rows: tasks }\n',
)

let shown: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.replaceChildren()
})

function kitOf(rows: readonly Row[], change: (base: unknown) => Promise<void>) {
  const context = contextFor({ rows, today: TODAY, now: `${TODAY}T10:00:00` })
  const live = {
    base: BASE,
    at: 0,
    view: BASE.views[0] ?? null,
    rows,
    context,
    today: TODAY,
    writtenAt: null,
    fixed: false,
    answer: answer(BASE, 0, rows, context),
    columns: columnsOf(BASE, 0, rows),
    colourOf: () => null,
    change,
  }
  return kitFor(live as unknown as Parameters<typeof kitFor>[0], {}, null, false)
}

function place(): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  return target
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

test('Escape out of a cell being written in writes nothing of what was typed', async () => {
  const kit = kitOf([taskRow('Errands.md', '- [ ] Call the bank', 2)], () => Promise.resolve())
  const written = vi.spyOn(kit, 'write').mockImplementation(() => undefined)
  const target = place()
  shown = mount(TableLayout, { target, props: { kit } })
  flushSync()
  const cell = target.querySelector<HTMLElement>('[role="gridcell"]')
  cell?.click()
  flushSync()
  cell?.click()
  flushSync()
  const field = target.querySelector<HTMLInputElement>('input.edit')
  if (!field) throw new Error('no field')
  field.value = 'Call the post office'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
  await tick()
  expect(target.querySelector('input.edit')).toBeNull()
  expect(written).not.toHaveBeenCalled()
})

test('Enter in a cell writes what was typed once', async () => {
  const kit = kitOf([taskRow('Errands.md', '- [ ] Call the bank', 2)], () => Promise.resolve())
  const written = vi.spyOn(kit, 'write').mockImplementation(() => undefined)
  const target = place()
  shown = mount(TableLayout, { target, props: { kit } })
  flushSync()
  const cell = target.querySelector<HTMLElement>('[role="gridcell"]')
  cell?.click()
  flushSync()
  cell?.click()
  flushSync()
  const field = target.querySelector<HTMLInputElement>('input.edit')
  if (!field) throw new Error('no field')
  field.value = 'Call the post office'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  flushSync()
  await tick()
  expect(written).toHaveBeenCalledTimes(1)
})

test('Escape out of renaming a view keeps its name', async () => {
  const changed = vi.fn(() => Promise.resolve())
  const kit = kitOf([], changed)
  const target = place()
  shown = mount(ViewHead, { target, props: { kit, title: 'Tasks', onadd: () => undefined } })
  flushSync()
  const tab = target.querySelector<HTMLElement>('[role="tab"]')
  tab?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  flushSync()
  await frame()
  const field = target.querySelector<HTMLInputElement>('input.rename')
  if (!field) throw new Error('no field')
  expect(document.activeElement).toBe(field)
  field.value = 'Month'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
  await tick()
  expect(target.querySelector('input.rename')).toBeNull()
  expect(changed).not.toHaveBeenCalled()
})
