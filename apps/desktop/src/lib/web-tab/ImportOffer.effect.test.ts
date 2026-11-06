import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const found = vi.hoisted(() => ({
  zen: [] as { name: string; path: string; files: string[] }[],
  browsers: [] as {
    browser: string
    name: string
    profiles: { browser: string; name: string; path: string; files: string[] }[]
  }[],
}))

const migrating = vi.hoisted(() => ({
  working: false,
  profiles: null as unknown[] | null,
  browserProfiles: null as unknown[] | null,
  zen: vi.fn(async () => undefined),
  browser: vi.fn(async (_one: unknown) => undefined),
}))

const offer = vi.hoisted(() => ({
  answered: vi.fn(),
  seen: vi.fn(),
  dropped: vi.fn(),
}))

const settings = vi.hoisted(() => ({ show: vi.fn() }))

vi.mock('../import/zen-profiles', () => ({ zenProfiles: async () => found.zen }))
vi.mock('../import/browsers', async (real) => ({
  ...(await real<typeof import('../import/browsers')>()),
  foundBrowsers: async () => found.browsers,
}))
vi.mock('../migrating.svelte', () => ({ migrating }))
vi.mock('../settings.svelte', () => ({ settings }))
vi.mock('./import-offer.svelte', () => ({ importOffer: offer }))
vi.mock('../i18n.svelte', () => ({ t: (text: string) => text }))

const ImportOffer = (await import('./ImportOffer.svelte')).default

let target: HTMLElement
let close: (() => void) | undefined

const DEFAULT = { browser: 'chrome', name: 'Default', path: '/c/Default', files: ['Bookmarks'] }

const CHROME = { browser: 'chrome', name: 'Chrome', profiles: [DEFAULT] }

beforeEach(() => {
  for (const one of [offer.answered, offer.seen, offer.dropped, settings.show]) one.mockClear()
  migrating.zen.mockClear()
  migrating.browser.mockClear()
  migrating.profiles = null
  migrating.browserProfiles = null
  found.zen = []
  found.browsers = []
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

async function draw() {
  const shown = mount(ImportOffer, { target, props: { tab: 't1' }, intro: false })
  close = () => void unmount(shown)
  await new Promise((done) => setTimeout(done, 0))
  await tick()
  flushSync()
}

function chips(): string[] {
  return [...target.querySelectorAll('.nib-chip')].map((one) => one.textContent.trim())
}

describe('the offer to bring another browser’s data on a new web tab', () => {
  test('names every browser found here, Zen first, and counts the day', async () => {
    found.zen = [{ name: 'Default', path: '/z', files: ['zen-sessions.jsonlz4'] }]
    found.browsers = [CHROME]
    await draw()
    expect(chips()).toEqual(['Zen', 'Chrome'])
    expect(offer.seen).toHaveBeenCalledOnce()
  })

  test('shows nothing and lets go of the tab when no browser is found', async () => {
    await draw()
    expect(target.querySelector('[data-import-offer]')).toBeNull()
    expect(offer.dropped).toHaveBeenCalledWith('t1')
    expect(offer.seen).not.toHaveBeenCalled()
  })

  test('a browser with one profile imports at once and is not asked again', async () => {
    found.browsers = [CHROME]
    await draw()
    target.querySelector<HTMLButtonElement>('.nib-chip')?.click()
    await tick()
    expect(offer.answered).toHaveBeenCalledOnce()
    expect(migrating.browser).toHaveBeenCalledWith(CHROME)
    expect(settings.show).not.toHaveBeenCalled()
  })

  test('a browser with several profiles opens the import settings to choose one', async () => {
    found.browsers = [
      { ...CHROME, profiles: [DEFAULT, { ...DEFAULT, name: 'Work', path: '/c/Work' }] },
    ]
    migrating.browser.mockImplementation(async () => {
      migrating.browserProfiles = found.browsers[0]?.profiles ?? null
    })
    await draw()
    target.querySelector<HTMLButtonElement>('.nib-chip')?.click()
    await new Promise((done) => setTimeout(done, 0))
    expect(settings.show).toHaveBeenCalledWith('import')
  })

  test('no thanks ends it without importing', async () => {
    found.browsers = [CHROME]
    await draw()
    target.querySelector<HTMLButtonElement>('[aria-label="No thanks"]')?.click()
    expect(offer.answered).toHaveBeenCalledOnce()
    expect(migrating.browser).not.toHaveBeenCalled()
  })
})
