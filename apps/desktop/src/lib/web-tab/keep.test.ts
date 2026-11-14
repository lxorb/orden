import { beforeEach, expect, test, vi } from 'vitest'

interface Call {
  path: string
  content: string
}

const written: Call[] = []
const told: Call[] = []

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'write_note') {
      written.push({ path: String(args.path), content: String(args.content) })
    }
    return Promise.resolve(undefined)
  },
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string, content: string) => told.push({ path, content }),
  },
}))

const readOnly = new Set<string>()

vi.mock('../sharing.svelte', () => ({
  canWriteAt: (path: string) => !readOnly.has(path),
}))

const { keepPage, keepNow } = await import('./keep')
const { SAVE_AT_MOST, SAVE_DELAY } = await import('../platform/src/backoff')
const { settleUp, written: landed } = await import('../parting')

const PATH = '/Notes/Svelte docs.url'
const FILE =
  '[InternetShortcut]\r\nURL=https://svelte.dev/docs\r\n' +
  'Title=Svelte docs\r\nOrden-Added=2026-09-12T08:30:00.000Z\r\n'

function said(): string {
  return written.at(-1)?.content ?? ''
}

beforeEach(() => {
  keepNow(PATH)
  written.length = 0
  told.length = 0
  readOnly.clear()
  vi.useFakeTimers()
})

test('writes the page the reading got to, and keeps where the note points', async () => {
  let text = FILE
  keepPage({
    path: PATH,
    text: () => text,
    url: 'https://svelte.dev/docs/svelte/what-are-runes',
    icon: 'https://svelte.dev/favicon.png',
    wrote: (next) => (text = next),
  })

  expect(written).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(SAVE_DELAY - 50)
  expect(written).toHaveLength(0)

  await vi.advanceTimersByTimeAsync(100)

  expect(written).toHaveLength(1)
  expect(said()).toContain('URL=https://svelte.dev/docs/svelte/what-are-runes')
  expect(said()).toContain('Orden-Home=https://svelte.dev/docs')
  expect(said()).toContain('Orden-Icon=https://svelte.dev/favicon.png')
  expect(said()).toContain('Title=Svelte docs')
  expect(said()).toContain('Orden-Added=2026-09-12T08:30:00.000Z')
  expect(text).toBe(said())
})

test('a page that moves twice in a moment is one write', async () => {
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'https://svelte.dev/a',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(200)
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'https://svelte.dev/b',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(1)
  expect(said()).toContain('URL=https://svelte.dev/b')
})

test('the home already in the file is the home that stays', async () => {
  const moved =
    '[InternetShortcut]\r\nURL=https://svelte.dev/docs/one\r\n' +
    'Title=Svelte docs\r\nOrden-Added=2026-09-12T08:30:00.000Z\r\n' +
    'Orden-Home=https://svelte.dev/docs\r\n'

  keepPage({
    path: PATH,
    text: () => moved,
    url: 'https://svelte.dev/docs/two',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(said()).toContain('URL=https://svelte.dev/docs/two')
  expect(said()).toContain('Orden-Home=https://svelte.dev/docs')
})

test('a page that has not moved is not written', async () => {
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'https://svelte.dev/docs',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(0)
})

test('an address that is not the web is never written', async () => {
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'file:///C:/notes',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(0)
})

test('tells the index what the file now says, so the row can wear the favicon', async () => {
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'https://svelte.dev/docs/svelte/runes',
    icon: 'https://svelte.dev/favicon.png',
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(told).toHaveLength(1)
  expect(told[0]?.path).toBe(PATH)
  expect(told[0]?.content).toBe(said())
  expect(told[0]?.content).toContain('Orden-Icon=https://svelte.dev/favicon.png')
})

test('says nothing to the index when there was nothing to write', async () => {
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'https://svelte.dev/docs',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(0)
  expect(told).toHaveLength(0)
})

test('a choice made while a write is waiting is in the file the write makes', async () => {
  let text = FILE
  keepPage({
    path: PATH,
    text: () => text,
    url: 'https://svelte.dev/docs/svelte/runes',
    icon: null,
    wrote: (next) => (text = next),
  })

  text = `${FILE}Orden-Data=0123456789abcdef\r\n`
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(1)
  expect(said()).toContain('Orden-Data=0123456789abcdef')
  expect(said()).toContain('URL=https://svelte.dev/docs/svelte/runes')
  expect(text).toBe(said())
})

test('a mark already held as a picture is not written over on its own', async () => {
  const held = `${FILE}Orden-Icon=data:image/png;base64,AAAA\r\n`
  keepPage({
    path: PATH,
    text: () => held,
    url: 'https://svelte.dev/docs',
    icon: 'data:image/png;base64,BBBB',
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)
  expect(written).toHaveLength(0)

  keepPage({
    path: PATH,
    text: () => held,
    url: 'https://svelte.dev/docs/svelte/runes',
    icon: 'data:image/png;base64,BBBB',
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)
  expect(said()).toContain('Orden-Icon=data:image/png;base64,BBBB')
})

test('a reading that never settles is written at the longest wait a note has', async () => {
  for (let step = 0; step < 12; step++) {
    keepPage({
      path: PATH,
      text: () => FILE,
      url: `https://svelte.dev/page-${step}`,
      icon: null,
      wrote: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY / 2)
  }

  expect(written.length).toBeGreaterThanOrEqual(1)
  expect(written.length).toBeLessThanOrEqual(Math.ceil((12 * SAVE_DELAY) / 2 / SAVE_AT_MOST) + 1)
})

test('the window going writes what is waiting, and waits for it', async () => {
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'https://svelte.dev/docs/kit',
    icon: null,
    wrote: () => undefined,
  })
  expect(written).toHaveLength(0)

  settleUp()
  await landed()

  expect(said()).toContain('URL=https://svelte.dev/docs/kit')
  await vi.advanceTimersByTimeAsync(2500)
  expect(written).toHaveLength(1)
})

test('leaving the tab writes what is waiting for its note', () => {
  keepPage({
    path: PATH,
    text: () => FILE,
    url: 'https://svelte.dev/docs/cli',
    icon: null,
    wrote: () => undefined,
  })
  keepNow(PATH)

  expect(said()).toContain('URL=https://svelte.dev/docs/cli')
})

test('a .webloc keeps its plist, with nothing in it changed but the address', async () => {
  const path = '/Notes/Docs.webloc'
  const plist = (url: string) =>
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n' +
    `\t<key>Name</key>\n\t<string>Docs</string>\n\t<key>URL</key>\n\t<string>${url}</string>\n` +
    '</dict>\n</plist>\n'
  let text = plist('https://svelte.dev/')
  keepPage({
    path,
    text: () => text,
    url: 'https://svelte.dev/docs?a=1&b=2',
    icon: 'https://svelte.dev/favicon.png',
    wrote: (next) => (text = next),
  })
  keepNow(path)
  await vi.advanceTimersByTimeAsync(0)

  expect(said()).toBe(plist('https://svelte.dev/docs?a=1&amp;b=2'))
  expect(text).toBe(said())
})

test('a .webloc is not written for a page that only said its mark', async () => {
  const path = '/Notes/Docs.webloc'
  const plist =
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n' +
    '\t<key>URL</key>\n\t<string>https://svelte.dev/</string>\n</dict>\n</plist>\n'
  keepPage({
    path,
    text: () => plist,
    url: 'https://svelte.dev/',
    icon: 'https://svelte.dev/favicon.png',
    wrote: () => undefined,
  })
  keepNow(path)
  await vi.advanceTimersByTimeAsync(0)

  expect(written).toHaveLength(0)
})

test('a note in a space shared to be read is never written, nor its copy changed', async () => {
  readOnly.add(PATH)
  let text = FILE
  const kept = (url: string, icon: string | null) =>
    keepPage({ path: PATH, text: () => text, url, icon, wrote: (next) => (text = next) })

  kept('https://svelte.dev/docs/kit', null)
  kept('https://svelte.dev/docs/kit', 'https://svelte.dev/favicon.png')
  await vi.advanceTimersByTimeAsync(SAVE_AT_MOST * 2)
  keepNow(PATH)
  settleUp()
  await landed()

  expect(written).toEqual([])
  expect(told).toEqual([])
  expect(text).toBe(FILE)
})
