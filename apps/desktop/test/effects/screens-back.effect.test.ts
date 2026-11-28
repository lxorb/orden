import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { Screens } from '../../src/lib/ui-kit/src/back-screens.svelte'
import { closeOnBack } from '../../src/lib/ui-kit/src/backstack.svelte'
import { viewport } from '../../src/lib/ui-kit/src/viewport.svelte'
import { computed, reactive, root, watch } from './runes.svelte'
import { settle } from './settle'

interface Shown {
  tabs: { id: string; at: number }[]
  active: string | null
  panel: boolean
}
const depth = () => (history.state as { ordenDepth?: number } | null)?.ordenDepth ?? 0
function app(): { shown: Shown; stop: () => void } {
  const shown = reactive<Shown>({ tabs: [{ id: 'a', at: 0 }], active: 'a', panel: false })
  const screens = new Screens()
  const stop = root(() => {
    const onPhone = computed(() => viewport.device === 'phone')
    const active = computed(() => shown.tabs.find((one) => one.id === shown.active) ?? null)
    watch(() => closeOnBack(shown.panel, () => (shown.panel = false)))
    watch(() => {
      if (!onPhone()) return
      const tab = active()
      screens.seen(tab ? { tab: tab.id, at: tab.at } : null)
    })
    watch(() => {
      if (onPhone()) screens.keep(shown.tabs.map((one) => one.id))
    })
    const uncovered = computed(() => !shown.panel)
    watch(() =>
      closeOnBack(onPhone() && uncovered() && screens.depth > 0, () => {
        const to = screens.back()
        if (!to) return
        const tab = shown.tabs.find((one) => one.id === to.tab)
        if (to.tab === shown.active && tab) tab.at = to.at
        else shown.active = to.tab
      }),
    )
  })
  return { shown, stop }
}
function opened(shown: Shown, id: string) {
  shown.tabs.push({ id, at: 0 })
  shown.active = id
  flushSync()
}
async function back() {
  history.back()
  await settle()
  flushSync()
}
beforeEach(async () => {
  viewport.device = 'phone'
  await settle()
})
afterEach(() => {
  viewport.device = 'desktop'
})
test('on a phone Back goes through the notes opened one after another, then has nothing left to take', async () => {
  const { shown, stop } = app()
  flushSync()
  expect(depth()).toBe(0)
  opened(shown, 'b')
  opened(shown, 'c')
  await settle()
  expect(depth()).toBe(1)
  await back()
  expect(shown.active).toBe('b')
  await back()
  expect(shown.active).toBe('a')
  await settle()
  expect(depth()).toBe(0)
  stop()
})
test('a step inside a note’s tab is gone back through before the tab before it', async () => {
  const { shown, stop } = app()
  flushSync()
  opened(shown, 'b')
  const tab = shown.tabs.find((one) => one.id === 'b')
  if (tab) tab.at = 1
  flushSync()
  await settle()
  await back()
  expect([shown.active, tab?.at]).toEqual(['b', 0])
  await back()
  expect(shown.active).toBe('a')
  stop()
})
test('a panel over the note closes first, and only the next Back leaves the note', async () => {
  const { shown, stop } = app()
  flushSync()
  opened(shown, 'b')
  shown.panel = true
  flushSync()
  await settle()
  expect(depth()).toBe(1)
  await back()
  expect([shown.panel, shown.active]).toEqual([false, 'b'])
  await settle()
  expect(depth()).toBe(1)
  await back()
  expect(shown.active).toBe('a')
  stop()
})
test('a note closed on the way is passed over', async () => {
  const { shown, stop } = app()
  flushSync()
  opened(shown, 'b')
  opened(shown, 'c')
  shown.tabs = shown.tabs.filter((one) => one.id !== 'b')
  flushSync()
  await settle()
  await back()
  expect(shown.active).toBe('a')
  await settle()
  expect(depth()).toBe(0)
  stop()
})
test('on a desktop nothing of this enters the history', async () => {
  viewport.device = 'desktop'
  await settle()
  const before = history.length
  const { shown, stop } = app()
  flushSync()
  opened(shown, 'b')
  opened(shown, 'c')
  await settle()
  expect([history.length, depth()]).toEqual([before, 0])
  stop()
})
test('the window registers exactly this, on a phone only, under whatever covers the note', () => {
  const window = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'App.svelte'), 'utf8')
  expect(window).toContain("const onPhone = $derived(viewport.device === 'phone')")
  expect(window).toContain(
    'const uncovered = $derived(!covered && !coveredRight && !palette && !menu.open && !fullscreen.on)',
  )
  expect(window).toContain('$effect(() => closeOnBack(onPhone && uncovered && screens.depth > 0, backAScreen))')
  expect(window).toContain('if (event.button === 3) workspace.goBack()')
})
