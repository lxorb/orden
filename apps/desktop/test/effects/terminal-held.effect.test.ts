import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const asked: { command: string; args: Record<string, unknown> }[] = []
let stillHeld = false

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'windows',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    if (command === 'terminal_shells') return Promise.resolve([{ id: 'pwsh', name: 'PowerShell' }])
    if (command === 'remote_hosts') {
      return Promise.resolve({
        config: [{ id: 'pi', also: [], hostname: '10.0.0.5' }],
        kept: { own: [], about: { pi: { colour: '4' } }, order: [], groups: [] },
        file: null,
      })
    }
    if (command === 'remote_keep') return Promise.resolve(args.kept)
    if (command === 'pty_held') return Promise.resolve(stillHeld)
    if (command === 'pty_spawn') return Promise.resolve({ pid: 1, fresh: !stillHeld })
    if (command === 'terminal_history_read') {
      return Promise.resolve({ cols: 80, rows: 24, at: 1, text: 'saved-before' })
    }
    return Promise.resolve(null)
  },
}))

const channels: { onmessage: ((message: unknown) => void) | null }[] = []

vi.mock('../../src/lib/crate/src/native', () => ({
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null
    constructor() {
      channels.push(this)
    }
  },
  invoke: () => Promise.resolve(null),
}))

const written: string[] = []
let resets = 0

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
    buffer = { active: { type: 'normal' } }
    parser = { registerOscHandler: () => ({ dispose: () => undefined }) }
    registerLinkProvider() {
      return { dispose: () => undefined }
    }
    loadAddon(addon: { activate?: (term: unknown) => void }) {
      addon.activate?.(this)
    }
    onData = () => undefined
    onBinary = () => undefined
    onBell = () => ({ dispose: () => undefined })
    onTitleChange = () => undefined
    onResize = () => undefined
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
    hasSelection = () => false
    reset() {
      resets += 1
    }
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
  observe = () => undefined
  unobserve = () => undefined
  disconnect = () => undefined
}
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
})

const { workspace } = await import('../../src/lib/workspace/src/api')
const { writeSpec } = await import('../../src/lib/terminal/src/spec')
const { sessionOf } = await import('../../src/lib/terminal/src/sessions.svelte')
const { openRemote } = await import('../../src/lib/terminal/src/remote/open')
const { shells } = await import('../../src/lib/terminal/src/shells.svelte')

const calls = (command: string) => asked.filter((one) => one.command === command)
const spawns = () => calls('pty_spawn')
const said = (message: unknown) => channels.at(-1)?.onmessage?.(message)

let place: HTMLElement

beforeEach(() => {
  asked.length = 0
  written.length = 0
  resets = 0
  stillHeld = false
  shells.restoring = true
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: 'C:\\work' }]
  workspace.activeSpaceId = 's'
  place = document.createElement('div')
  document.body.append(place)
})

afterEach(() => {
  vi.restoreAllMocks()
  workspace.tabs = []
  flushSync()
  place.remove()
})

function reopened(shell: string, key: string) {
  workspace.openUnsaved('terminal', writeSpec({ shell, folder: null, key, name: null }), 'Shell')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  return tab
}

async function connected() {
  await openRemote('pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  return tab
}

function later(by: number) {
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + by)
}

test('a shell still running after a restart is attached to, not replaced by its saved screen', async () => {
  stillHeld = true
  const tab = reopened('pwsh', 'k-held')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))

  expect(spawns()[0]?.args.key).toBe('k-held')
  expect(calls('terminal_history_read')).toHaveLength(0)
  expect(written.join('')).not.toContain('saved-before')

  said({ screen: 'vim on its own screen', cols: 100, rows: 30 })
  await vi.waitFor(() => expect(written).toContain('vim on its own screen'))
  expect(resets).toBe(1)
})

test('a shell whose session is gone comes back from its saved screen and starts again', async () => {
  const tab = reopened('pwsh', 'k-gone')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  expect(written.join('')).toContain('saved-before')
  expect(spawns()[0]?.args.key).toBe('k-gone')
})

test('a remote tab whose session still runs attaches at once, with no Reconnect to press', async () => {
  stillHeld = true
  const tab = reopened('ssh:pi', 'r-held')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  expect(sessionOf(tab).offline).toBe(false)
  expect(spawns()[0]?.args).toMatchObject({ shell: 'ssh:pi', key: 'r-held', plain: false })
})

test('a connection that drops after it was up comes back by itself, to the same session', async () => {
  const tab = await connected()
  const key = spawns()[0]?.args.key
  later(11_000)
  said({ exit: 255 })
  flushSync()
  expect(sessionOf(tab).offline).toBe(true)
  expect(written.join('')).toContain('Disconnected from pi, reconnecting')

  await vi.waitFor(() => expect(spawns()).toHaveLength(2), { timeout: 3000 })
  expect(spawns()[1]?.args).toMatchObject({ shell: 'ssh:pi', key, plain: false })
  expect(sessionOf(tab).offline).toBe(false)
})

test('a connection that keeps failing goes on trying, slower each time', async () => {
  await connected()
  later(11_000)
  said({ exit: 255 })
  await vi.waitFor(() => expect(spawns()).toHaveLength(2), { timeout: 3000 })
  vi.restoreAllMocks()
  said({ exit: 255 })
  await new Promise((settle) => setTimeout(settle, 1500))
  expect(spawns()).toHaveLength(2)
  await vi.waitFor(() => expect(spawns()).toHaveLength(3), { timeout: 3000 })
})

test('closing a tab ends its session, and Detach lets it go on running', async () => {
  const one = reopened('pwsh', 'k-close')
  await sessionOf(one).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  workspace.close(one.id)
  flushSync()
  expect(calls('pty_kill')).toHaveLength(1)
  expect(calls('pty_detach')).toHaveLength(0)

  const other = reopened('pwsh', 'k-detach')
  const session = sessionOf(other)
  await session.attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(2))
  expect(session.detachable).toBe(true)
  session.detachSession()
  flushSync()
  expect(workspace.tabs.some((tab) => tab.id === other.id)).toBe(false)
  expect(calls('pty_detach')).toHaveLength(1)
  expect(calls('pty_kill')).toHaveLength(1)
})

test('closing a remote tab while it is disconnected asks the host to end the session', async () => {
  const tab = reopened('ssh:pi', 'r-down')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(sessionOf(tab).offline).toBe(true))
  workspace.close(tab.id)
  flushSync()
  await vi.waitFor(() => expect(calls('remote_end')).toHaveLength(1))
  expect(calls('remote_end')[0]?.args).toEqual({ host: 'pi', key: 'r-down' })
})

test('a host without tmux is connected to plainly and said to be not persistent', async () => {
  const tab = await connected()
  said({ exit: 127 })
  await vi.waitFor(() => expect(spawns()).toHaveLength(2))
  expect(spawns()[1]?.args).toMatchObject({ shell: 'ssh:pi', plain: true })
  expect(written.join('')).toContain('pi has no tmux, so this session is not persistent')
  expect(sessionOf(tab).offline).toBe(false)
})
