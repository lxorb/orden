import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { closeOnBack } from '../../src/lib/backstack.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'
import { STARTS_RIGHT } from '../../src/lib/workspace/panels'
import { computed, root, watch } from './runes.svelte'

beforeEach(async () => {
  viewport.device = 'phone'
  workspace.panel = null
  workspace.right = []
  for (let turn = 0; turn < 6; turn++) await new Promise((resolve) => setTimeout(resolve, 5))
})

afterEach(() => {
  workspace.panel = null
  workspace.right = [...STARTS_RIGHT]
  viewport.device = 'desktop'
})

function registerAsTheAppDoes(): () => void {
  return root(() => {
    const covered = computed(() => !!workspace.panel)
    watch(() => closeOnBack(covered(), () => workspace.closePanel()))
  })
}

test('one drawer is one history entry, however often the panel inside it changes', () => {
  const stop = registerAsTheAppDoes()
  flushSync()

  const before = history.length

  workspace.showPanel('outline')
  flushSync()
  expect(workspace.panel).toBe('outline')
  expect(history.length).toBe(before + 1)

  workspace.showPanel('links')
  flushSync()
  expect(workspace.panel).toBe('links')
  expect(history.length).toBe(before + 1)

  workspace.showPanel('outline')
  flushSync()
  expect(workspace.panel).toBe('outline')
  expect(history.length).toBe(before + 1)

  workspace.showPanel('search')
  flushSync()
  expect(workspace.panel).toBe('search')
  expect(history.length).toBe(before + 1)

  stop()
})

test('and the entry is given back when the drawer itself closes', async () => {
  const stop = registerAsTheAppDoes()
  flushSync()

  workspace.showPanel('outline')
  flushSync()
  expect((history.state as { ordenDepth?: number } | null)?.ordenDepth).toBe(1)

  const heard = new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
  })

  workspace.closePanel()
  flushSync()
  await heard
  flushSync()

  expect(workspace.panel).toBe(null)

  stop()
})
