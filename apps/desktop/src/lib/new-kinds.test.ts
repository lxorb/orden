import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const online = vi.hoisted(() => ({ made: null as string[] | null }))
vi.mock('./terminal/src/online/open', () => ({
  openOnline: () => {
    online.made?.push('online')
    return Promise.resolve(null)
  },
}))
vi.mock('./apps/src/make', () => ({
  makeApplication: () => {
    online.made?.push('application')
    return Promise.resolve(null)
  },
}))

const { kindLines, newKinds } = await import('./new-kinds')
const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./ui-kit/src/viewport.svelte')
const { APPS_WORD, EXPERIMENTAL_WORD, hiddenKinds, PASS_WORD } = await import('./settings.svelte')

let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  localStorage.clear()
  hiddenKinds.hidden = [EXPERIMENTAL_WORD, APPS_WORD, PASS_WORD]
})

afterEach(() => {
  viewport.device = was
  vi.restoreAllMocks()
})

function makers(): string[] {
  const made: string[] = []

  vi.spyOn(workspace, 'openBlank').mockImplementation(() => void made.push('note'))
  vi.spyOn(workspace, 'newCanvas').mockImplementation(async () => void made.push('canvas'))
  vi.spyOn(workspace, 'openPage').mockImplementation((url: string) => {
    made.push(`web ${url}`)
    return null
  })
  vi.spyOn(workspace, 'newPages').mockImplementation(async () => void made.push('pages'))
  online.made = made

  return made
}

describe('the kinds a new tab can be', () => {
  test('are the four, an online terminal, an application and Pass, in the order a reader is offered them', () => {
    expect(newKinds().map((one) => one.kind)).toEqual([
      'note',
      'canvas',
      'pages',
      'online',
      'application',
      'pass',
      'web',
    ])
  })

  test('stand in three lines: what is written, what runs, and the web', () => {
    expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
      ['note', 'canvas', 'pages'],
      ['online', 'application', 'pass'],
      ['web'],
    ])
  })

  test('read as the words every menu in the app already uses', () => {
    expect(newKinds().map((one) => one.label())).toEqual([
      'New note',
      'New canvas',
      'New page note',
      'Online terminal',
      'New application',
      'Pass',
      'New web note',
    ])
  })

  test('each wears the mark its own files wear', () => {
    expect(newKinds().map((one) => one.mark)).toEqual([
      'note',
      'canvas',
      'pages',
      'terminal',
      'application',
      'key',
      'web',
    ])
  })

  test('leave the website out on a phone', () => {
    viewport.device = 'phone'
    expect(newKinds().map((one) => one.kind)).toEqual([
      'note',
      'canvas',
      'pages',
      'online',
      'application',
      'pass',
    ])
  })

  test('and on a tablet', () => {
    viewport.device = 'tablet'
    expect(newKinds().map((one) => one.kind)).toEqual([
      'note',
      'canvas',
      'pages',
      'online',
      'application',
      'pass',
    ])
  })

  test('make one each', async () => {
    const made = makers()
    for (const one of newKinds()) one.make()

    await vi.waitFor(() =>
      expect([...made].sort()).toEqual([
        'application',
        'canvas',
        'note',
        'online',
        'pages',
        'web https://www.google.com/',
      ]),
    )
  })

  test('a web note opens the search engine this device chose', async () => {
    const made = makers()
    const { searchEngine } = await import('./web-tab/search-engine.svelte')
    searchEngine.choose('duckduckgo')

    newKinds()
      .find((one) => one.kind === 'web')
      ?.make()

    await vi.waitFor(() => expect(made).toEqual(['web https://duckduckgo.com/']))
    searchEngine.choose('google')
  })

  test('in the pane that asked', () => {
    makers()
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)

    newKinds()[0]?.make('a-pane')
    expect(focused).toHaveBeenCalledWith('a-pane')
  })

  test('and in whichever pane has the keyboard when nobody names one', () => {
    makers()
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)

    newKinds()[0]?.make()
    expect(focused).not.toHaveBeenCalled()
  })

  test('each answers a letter of its own', () => {
    const letters = newKinds().map((one) => one.letter)

    expect(letters).toEqual(['n', 'c', 'p', 'o', 'a', 'k', 'w'])
    expect(new Set(letters).size).toBe(letters.length)
  })
})
