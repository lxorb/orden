import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

test("a tab's button is the tab's own shape, so the one focus ring follows its rounded top", () => {
  const tabs = readFileSync(join(import.meta.dirname, 'Tabs.svelte'), 'utf8')
  const pick = /\n {2}\.pick \{([^}]*)\}/.exec(tabs)?.[1] ?? ''
  expect(pick).toContain('inset: var(--tab-top) 3px 0;')
  expect(pick).toContain('border-radius: var(--round) var(--round) 0 0;')
  expect(tabs).not.toMatch(/\.pick:focus/)
})
