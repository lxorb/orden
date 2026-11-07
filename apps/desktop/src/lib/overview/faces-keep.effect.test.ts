import { afterEach, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

const store = vi.hoisted(() => ({ written: [] as [string, unknown][], gone: [] as string[] }))
vi.mock('./faces', async (real) => ({
  ...(await real<typeof import('./faces')>()),
  writeFace: (key: string, face: unknown) => {
    store.written.push([key, face])
    return Promise.resolve()
  },
  forgetFaces: (keys: string[]) => {
    store.gone.push(...keys)
    return Promise.resolve()
  },
  readFaces: () => Promise.resolve([]),
}))

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../workspace.svelte')
const { pages } = await import('../web-tab/pages.svelte')
const { faces } = await import('./faces.svelte')
const { places } = await import('./places.svelte')

workspace.restored = true

function web(inPrivate: boolean) {
  workspace.openWebsite(inPrivate)
  flushSync()
  const id = workspace.activeTabId ?? ''
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab) throw new Error('no tab')
  tab.address = 'https://bank.example/'
  return tab
}

afterEach(() => {
  for (const tab of [...workspace.tabs]) workspace.close(tab.id)
  flushSync()
  store.written.length = 0
  store.gone.length = 0
})

test('a private tab’s page is never written down, by picture or by name', () => {
  const tab = web(true)
  pages.of(tab.id).shot = 'data:image/png;base64,PRIVATE'
  flushSync()
  expect(store.written).toEqual([])
  expect(faces.of(tab.id)).toBe(null)

  places.keepWindows({ [tab.id]: { x: 1, y: 2, w: 3, h: 4 } }, workspace.tabs)
  expect(places.windows[tab.id]).toEqual({ x: 1, y: 2, w: 3, h: 4 })
  expect(localStorage.getItem('orden:overview-windows-2')).toBe('{}')
})

test('a private tab beside others takes nobody’s name, and leaves them theirs', () => {
  const kept = web(false)
  pages.of(kept.id).shot = 'data:image/png;base64,ONE'
  flushSync()
  const name = store.written[0]?.[0]
  expect(name).toBeTruthy()

  const hidden = web(true)
  store.written.length = 0
  pages.of(kept.id).shot = 'data:image/png;base64,TWO'
  pages.of(hidden.id).shot = 'data:image/png;base64,PRIVATE'
  flushSync()
  expect(store.written.map(([key]) => key)).toEqual([name])
})

test('a picture goes with its tab under the name it was written by, not the tab’s first', () => {
  const tab = web(false)
  tab.note.name = 'Bank login'
  flushSync()
  pages.of(tab.id).shot = 'data:image/png;base64,ONE'
  flushSync()
  const [written] = store.written.map(([key]) => key)
  expect(written).toBe('web:~Bank login')

  workspace.close(tab.id)
  flushSync()
  expect(store.gone).toContain(written)
})

test('a tab written under a new name lets go of the picture under the old', () => {
  const tab = web(false)
  tab.note.name = 'First page'
  flushSync()
  pages.of(tab.id).shot = 'data:image/png;base64,ONE'
  flushSync()
  tab.note.name = 'Second page'
  flushSync()
  pages.of(tab.id).shot = 'data:image/png;base64,TWO'
  flushSync()
  expect(store.written.map(([key]) => key)).toEqual(['web:~First page', 'web:~Second page'])
  expect(store.gone).toEqual(['web:~First page'])
})
