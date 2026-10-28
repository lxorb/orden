/** An online terminal whose server makes its way to the machine again (issue 962).
 *
 *  Emil: *"it says "starting machine" here in orden all the time, that's super annoying"*.
 *  The server said `starting` for every link it made again under a machine that never
 *  stopped - the link going quiet, the object restarted by a deploy - and every live
 *  terminal on it gave its screen up to "Starting machine…" until the next output. Now a
 *  dropped link keeps the screen and holds what is typed, says nothing for the second a
 *  relink takes, and says Connecting where it lasts; Starting machine is for a machine
 *  that is starting.
 *
 *  In the jsdom project because the tab's surface is mounted. */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Said } from '../../src/lib/terminal/source'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  invoke: () => Promise.resolve(null),
}))

vi.mock('../../src/lib/native', () => ({
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null
  },
  invoke: () => Promise.resolve(null),
}))

/** What the session's source says, and what was sent down it. */
let said: ((what: Said) => void) | null = null
const sent: string[] = []

vi.mock('../../src/lib/online/source', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/online/source')>()),
  onlineSource: () => ({
    remote: true,
    start: (_cols: number, _rows: number, hear: (what: Said) => void) => {
      said = hear
      return Promise.resolve()
    },
    write: (data: string) => {
      sent.push(data)
      return Promise.resolve()
    },
    resize: () => undefined,
    seen: () => undefined,
    end: () => undefined,
  }),
}))

let typing: ((data: string) => void) | null = null
/** What was written to the screen. */
const written: string[] = []

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    unicode = { activeVersion: '' }
    modes = {
      mouseTrackingMode: 'none',
      sendFocusMode: false,
      applicationCursorKeysMode: false,
      applicationKeypadMode: false,
      bracketedPasteMode: false,
      synchronizedOutputMode: false,
    }
    buffer = {
      active: {
        type: 'normal',
        viewportY: 0,
        baseY: 0,
        cursorX: 0,
        cursorY: 0,
        getLine: () => undefined,
      },
      onBufferChange: () => ({ dispose: () => undefined }),
    }
    element = undefined
    onRender = () => ({ dispose: () => undefined })
    parser = { registerOscHandler: () => ({ dispose: () => undefined }) }
    registerLinkProvider() {
      return { dispose: () => undefined }
    }
    loadAddon(addon: { activate?: (term: unknown) => void }) {
      addon.activate?.(this)
    }
    onData(listener: (data: string) => void) {
      typing = listener
    }
    onBinary = () => undefined
    onBell = () => ({ dispose: () => undefined })
    onTitleChange = () => ({ dispose: () => undefined })
    onResize = () => ({ dispose: () => undefined })
    attachCustomKeyEventHandler = () => undefined
    open = () => undefined
    resize = () => undefined
    write(data: unknown, then?: () => void) {
      if (typeof data === 'string') written.push(data)
      if (then) setTimeout(then, 0)
    }
    focus = () => undefined
    dispose = () => undefined
    clear = () => undefined
    reset = () => undefined
  },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = () => undefined
  },
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    onDidChangeResults = () => undefined
  },
}))
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize = () => ''
  },
}))
vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    activate = () => undefined
  },
}))

globalThis.ResizeObserver = class {
  observe() {
    // Nothing is measured here.
  }
  unobserve() {
    // Said above.
  }
  disconnect() {
    // Said above.
  }
}
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
})

const { workspace } = await import('../../src/lib/workspace.svelte')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { openTerm } = await import('../../src/lib/online/open')
const { statusLine } = await import('../../src/lib/online/arrival.svelte')

let place: HTMLElement

beforeEach(() => {
  said = null
  sent.length = 0
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/home/emil' }]
  workspace.activeSpaceId = 's'
  place = document.createElement('div')
  document.body.append(place)
})

afterEach(() => {
  vi.useRealTimers()
  workspace.tabs = []
  flushSync()
  place.remove()
})

/** An online terminal on its session's screen, live. */
async function live() {
  const tab = openTerm('/home/emil/Terminal.term')
  if (!tab) throw new Error('no tab')
  const session = sessionOf(tab)
  await session.attach(place, false)
  await vi.waitFor(() => expect(said).not.toBeNull())
  said?.({ connected: true })
  said?.({ machine: 'awake' })
  said?.({ screen: 'emil@machine:~$ ', cols: 80, rows: 24, restored: null })
  await vi.waitFor(() => expect(session.live).toBe(true))
  return session
}

const line = (session: Awaited<ReturnType<typeof live>>) =>
  session.status ? statusLine(session.status) : null

test('a relink keeps the screen, says nothing, and sends what was typed once it is back', async () => {
  const session = await live()

  said?.({ link: false })
  flushSync()
  expect(line(session)).toBeNull()
  typing?.('ls\r')
  await new Promise((settle) => setTimeout(settle, 0))
  expect(sent).toEqual([])

  said?.({ link: true })
  await vi.waitFor(() => expect(sent).toEqual(['ls\r']))
  expect(session.live).toBe(true)
  expect(line(session)).toBeNull()
})

test('an older server\'s "starting" for a relink is held the same, and never shown', async () => {
  const session = await live()

  said?.({ machine: 'starting' })
  flushSync()
  expect(line(session)).toBeNull()
  typing?.('pwd\r')

  said?.({ machine: 'awake' })
  await vi.waitFor(() => expect(sent).toEqual(['pwd\r']))
  expect(session.live).toBe(true)
  expect(line(session)).toBeNull()
})

test('a relink that lasts says Connecting, not Starting machine, and the screen comes back', async () => {
  const session = await live()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

  said?.({ link: false })
  vi.advanceTimersByTime(4000)
  flushSync()
  expect(line(session)).toBeNull()
  vi.advanceTimersByTime(1500)
  flushSync()
  expect(line(session)).toBe('Connecting…')

  vi.useRealTimers()
  said?.({ link: true })
  said?.({ screen: 'emil@machine:~$ ', cols: 80, rows: 24, restored: null })
  await vi.waitFor(() => expect(session.live).toBe(true))
  expect(line(session)).toBeNull()
})

test('a machine that really restarts says Starting machine once it is plain it is one', async () => {
  const session = await live()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

  said?.({ link: false })
  said?.({ machine: 'starting' })
  vi.advanceTimersByTime(5500)
  flushSync()
  expect(line(session)).toBe('Starting machine…')
})
