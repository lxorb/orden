import { expect, test } from 'vitest'
import { DIVIDER, type MenuEntry } from '../../ui-kit/src/menu-item'
import { newItemEntries } from './new-items'
import type { PassUi } from './ui.svelte'

function items(entries: MenuEntry[]) {
  return entries.filter((one) => one !== DIVIDER)
}

test('every New item entry and every Other template carries its icon', async () => {
  const entries = items(newItemEntries({} as PassUi, { x: 0, y: 0 }))
  expect(entries.length).toBeGreaterThan(6)
  for (const one of entries) expect(one.icon, one.label).toBeTruthy()

  const other = entries.find((one) => one.more)
  const templates = items((await other?.more?.()) ?? [])
  expect(templates.length).toBeGreaterThan(0)
  for (const one of templates) expect(one.icon, one.label).toBeTruthy()
})
