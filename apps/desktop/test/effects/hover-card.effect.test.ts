import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    onfinish: null,
  }) as unknown as Animation

const { hovering } = await import('../../src/lib/tab-strip/hover-card.svelte')
const { previewDelay } = await import('../../src/lib/tab-strip/preview-delay.svelte')
const { overlays } = await import('../../src/lib/overlays')
const { viewport } = await import('../../src/lib/viewport.svelte')
type Tab = import('../../src/lib/workspace.svelte').Tab

function tab(id: string, shown: string): Tab {
  return { id, shown, kind: 'note', path: null, paneId: 'nowhere' } as unknown as Tab
}

const BOX = { left: 100, right: 300, bottom: 38 }
const alpha = tab('a', 'Alpha')
const beta = tab('b', 'Beta')

const shownFor = () => hovering.card?.title ?? null

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  previewDelay.set(500)
  hovering.hush()
  hovering.leave('a')
  hovering.leave('b')
  vi.runAllTimers()
  vi.useRealTimers()
  viewport.device = 'desktop'
})

async function settle() {
  await vi.advanceTimersByTimeAsync(0)
  flushSync()
}

test('waits the Tab preview delay before the first card, half a second, and is drawn', async () => {
  expect(previewDelay.ms).toBe(500)
  hovering.enter({ tab: alpha, box: BOX })
  await vi.advanceTimersByTimeAsync(previewDelay.ms - 50)
  expect(shownFor()).toBeNull()

  await vi.advanceTimersByTimeAsync(60)
  await settle()
  expect(shownFor()).toBe('Alpha')
  expect(document.querySelector('.card')?.textContent).toContain('Alpha')
})

test('waits as long as the setting says, two seconds at most', async () => {
  previewDelay.set(5000)
  expect(previewDelay.ms).toBe(2000)
  previewDelay.set(1200)
  hovering.enter({ tab: alpha, box: BOX })
  await vi.advanceTimersByTimeAsync(1150)
  expect(shownFor()).toBeNull()
  await vi.advanceTimersByTimeAsync(60)
  await settle()
  expect(shownFor()).toBe('Alpha')
})

test('moves to the tab beside at once, and goes once the pointer has left the strip', async () => {
  hovering.enter({ tab: alpha, box: BOX })
  await vi.advanceTimersByTimeAsync(previewDelay.ms + 10)
  await settle()

  hovering.leave('a')
  hovering.enter({ tab: beta, box: { ...BOX, left: 300, right: 500 } })
  await settle()
  expect(shownFor()).toBe('Beta')
  expect(hovering.card?.sliding).toBe(true)

  hovering.leave('b')
  await settle()
  expect(shownFor()).toBeNull()

  hovering.enter({ tab: alpha, box: BOX })
  await settle()
  expect(shownFor()).toBe('Alpha')
})

test('goes on a press, and says nothing more about the tab pressed', async () => {
  hovering.enter({ tab: alpha, box: BOX })
  await vi.advanceTimersByTimeAsync(previewDelay.ms + 10)
  await settle()

  window.dispatchEvent(new PointerEvent('pointerdown'))
  expect(shownFor()).toBeNull()

  hovering.enter({ tab: alpha, box: BOX })
  await vi.advanceTimersByTimeAsync(previewDelay.ms + 10)
  await settle()
  expect(shownFor()).toBeNull()
})

test('never comes over a menu', async () => {
  const close = overlays.show(() => undefined)
  try {
    hovering.enter({ tab: alpha, box: BOX })
    await vi.advanceTimersByTimeAsync(previewDelay.ms + 10)
    await settle()
    expect(shownFor()).toBeNull()
  } finally {
    close()
  }
})

test('never under a finger', async () => {
  viewport.device = 'phone'
  hovering.enter({ tab: alpha, box: BOX, focused: true })
  await settle()
  expect(shownFor()).toBeNull()
})

test('comes at once for a tab the keyboard arrives at', async () => {
  hovering.enter({ tab: alpha, box: BOX, focused: true })
  await settle()
  expect(shownFor()).toBe('Alpha')
})

test('says the space a page of another space is from, and nothing for the space on screen', async () => {
  const { workspace } = await import('../../src/lib/workspace.svelte')
  workspace.spaces = [
    { id: 'work', name: 'Work', root: '/spaces/Work' },
    { id: 'home', name: 'Home', root: '/spaces/Home' },
  ]
  workspace.activeSpaceId = 'work'
  const page = (id: string, path: string | null, home: string | null) =>
    ({
      id,
      shown: 'Soup',
      kind: 'web',
      path,
      address: 'https://www.example.com/soup',
      note: { home },
      paneId: 'nowhere',
    }) as unknown as Tab

  hovering.enter({ tab: page('u', null, 'home'), box: BOX, focused: true })
  await settle()
  expect(hovering.card?.where).toBe('example.com')
  expect(hovering.card?.from).toEqual({ id: 'home', name: 'Home' })
  expect(document.querySelector('.card .from')?.textContent).toContain('Home')

  hovering.leave('u')
  await settle()
  hovering.enter({
    tab: page('w', '/spaces/Work/Soup.url', null),
    box: BOX,
    focused: true,
  })
  await settle()
  expect(hovering.card?.from).toBeNull()
  expect(document.querySelector('.card .from')).toBeNull()
  hovering.leave('w')
})
