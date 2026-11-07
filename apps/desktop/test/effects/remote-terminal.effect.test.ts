import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const asked: { command: string; args: Record<string, unknown> }[] = []
let refuse = false
let front: string | null = null
let reached: Record<string, unknown> | null = null

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
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
    if (command === 'pty_program') return Promise.resolve(front)
    if (command === 'pty_ssh') return Promise.resolve(reached)
    if (command === 'pty_spawn') {
      return refuse
        ? Promise.reject(new Error('no ssh on this machine'))
        : Promise.resolve({ pid: 1 })
    }
    return Promise.resolve(null)
  },
}))

const channels: { onmessage: ((message: unknown) => void) | null }[] = []

vi.mock('../../src/lib/native', () => ({
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null
    constructor() {
      channels.push(this)
    }
  },
  invoke: () => Promise.resolve(null),
}))

let typing: ((data: string) => void) | null = null
let titling: ((title: string) => void) | null = null
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
    buffer = { active: { type: 'normal' } }
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
    onTitleChange(listener: (title: string) => void) {
      titling = listener
    }
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
const { readSpec, writeSpec } = await import('../../src/lib/terminal/spec')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { openRemote } = await import('../../src/lib/remote/open')
const { shells } = await import('../../src/lib/terminal/shells.svelte')
const { renameTerminal } = await import('../../src/lib/terminal/rename')
const TerminalTab = (await import('../../src/lib/terminal/TerminalTab.svelte')).default

const spawns = () => asked.filter((one) => one.command === 'pty_spawn')

let place: HTMLElement

beforeEach(() => {
  asked.length = 0
  written.length = 0
  refuse = false
  front = null
  reached = null
  shells.restoring = false
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: 'C:\\work' }]
  workspace.activeSpaceId = 's'
  place = document.createElement('div')
  document.body.append(place)
})

afterEach(() => {
  workspace.tabs = []
  flushSync()
  place.remove()
})

async function connected() {
  await openRemote('pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  return tab
}

const exits = (code: number) => channels.at(-1)?.onmessage?.({ exit: code })

test('it is the system ssh for the host, named and coloured for it, whatever runs there', async () => {
  const tab = await connected()

  expect(spawns()[0]?.args.shell).toBe('ssh:pi')
  await vi.waitFor(() => expect(tab.shown).toBe('pi'))
  expect(tab.running).toMatchObject({ name: 'pi', host: 'pi', colour: '4', program: null })

  titling?.('emil@pi: ~')
  typing?.('vim notes\r')
  flushSync()
  expect(tab.shown).toBe('pi')
  await new Promise((settle) => setTimeout(settle, 400))
  expect(asked.some((one) => one.command === 'pty_program' || one.command === 'pty_folder')).toBe(
    false,
  )
})

test('a dropped connection puts up Reconnect, which connects again; never by itself', async () => {
  const tab = await connected()
  const surface = mount(TerminalTab, { target: place, props: { tab, focused: false } })
  const session = sessionOf(tab)

  exits(255)
  flushSync()
  expect(session.offline).toBe(true)
  expect(workspace.tabs).toHaveLength(1)
  const bar = () => place.querySelector<HTMLButtonElement>('.offline button')
  expect(bar()?.textContent).toBe('Reconnect')
  await new Promise((settle) => setTimeout(settle, 50))
  expect(spawns()).toHaveLength(1)

  bar()?.click()
  await vi.waitFor(() => expect(spawns()).toHaveLength(2))
  flushSync()
  expect(session.offline).toBe(false)
  await vi.waitFor(() => expect(bar()).toBeNull())

  exits(255)
  typing?.('\r')
  await vi.waitFor(() => expect(spawns()).toHaveLength(3))
  void unmount(surface, { outro: false })
})

test('`exit` on the other machine closes the tab, as a shell here does', async () => {
  await connected()
  exits(0)
  flushSync()
  expect(workspace.tabs).toHaveLength(0)
})

test('one a restart put back waits for Reconnect before it connects', async () => {
  const words = writeSpec({ shell: 'ssh:pi', folder: null, key: 'from-before', name: null })
  workspace.openUnsaved('terminal', words, 'pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')

  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(sessionOf(tab).offline).toBe(true))
  expect(spawns()).toHaveLength(0)

  typing?.('\r')
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  expect(readSpec(tab.doc)?.shell).toBe('ssh:pi')
})

test('one that will not start is never swapped for a shell on this machine', async () => {
  refuse = true
  await openRemote('pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  await sessionOf(tab).attach(place, false)

  await vi.waitFor(() => expect(sessionOf(tab).offline).toBe(true))
  expect(spawns().map((one) => one.args.shell)).toEqual(['ssh:pi'])
  expect(readSpec(tab.doc)?.shell).toBe('ssh:pi')
  expect(written.join('')).toContain('Could not connect to pi')
})

async function local() {
  workspace.openUnsaved(
    'terminal',
    writeSpec({ shell: 'pwsh', folder: null, key: 'here', name: null }),
    'PowerShell',
  )
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  return tab
}

test('ssh to a known host in a local tab makes it that host, with the connection kept', async () => {
  const tab = await local()

  front = 'ssh'
  reached = { hostname: 'pi', user: null, port: null }
  typing?.('ssh pi\r')
  await vi.waitFor(() => expect(readSpec(tab.doc)?.shell).toBe('ssh:pi'))
  expect(readSpec(tab.doc)?.via).toBe('pwsh')
  await vi.waitFor(() => expect(tab.shown).toBe('pi'))
  expect(tab.running).toMatchObject({ host: 'pi', colour: '4' })
  expect(spawns()).toHaveLength(1)

  front = null
  typing?.('exit\r')
  await vi.waitFor(() => expect(readSpec(tab.doc)?.shell).toBe('pwsh'), { timeout: 2500 })
  expect(readSpec(tab.doc)?.via).toBeUndefined()
  expect(tab.running?.host).toBeNull()
  expect(spawns()).toHaveLength(1)
})

test('ssh to an address no host has, or with a command, leaves the tab a shell here', async () => {
  const tab = await local()

  front = 'ssh'
  reached = { hostname: 'box.example.com', user: 'emil', port: 2222 }
  typing?.('ssh emil@box.example.com -p 2222\r')
  await vi.waitFor(() => expect(asked.some((one) => one.command === 'pty_ssh')).toBe(true))
  await new Promise((settle) => setTimeout(settle, 50))
  expect(readSpec(tab.doc)?.shell).toBe('pwsh')

  reached = null
  typing?.('ssh pi uptime\r')
  await new Promise((settle) => setTimeout(settle, 1500))
  expect(readSpec(tab.doc)?.shell).toBe('pwsh')
})

test('a local shell that ends under an ssh it was taken for ends as a shell here', async () => {
  const tab = await local()
  front = 'ssh'
  reached = { hostname: '10.0.0.5', user: null, port: null }
  typing?.('ssh 10.0.0.5\r')
  await vi.waitFor(() => expect(readSpec(tab.doc)?.shell).toBe('ssh:pi'))

  exits(1)
  flushSync()
  expect(readSpec(tab.doc)?.shell).toBe('pwsh')
  expect(sessionOf(tab).offline).toBe(false)
  expect(written.join('')).toContain('Exited with code 1')
})

test('one taken over and put back by a restart is a remote tab of its own', async () => {
  const words = writeSpec({ shell: 'ssh:pi', folder: null, key: 'before', name: null, via: 'pwsh' })
  workspace.openUnsaved('terminal', words, 'pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')

  await sessionOf(tab).attach(place, false)
  await vi.waitFor(() => expect(sessionOf(tab).offline).toBe(true))
  expect(spawns()).toHaveLength(0)

  typing?.('\r')
  await vi.waitFor(() => expect(spawns()).toHaveLength(1))
  expect(spawns()[0]?.args.shell).toBe('ssh:pi')
  expect(readSpec(tab.doc)?.via).toBeUndefined()
})

async function adopted() {
  const tab = await local()
  front = 'ssh'
  reached = { hostname: 'pi', user: null, port: null }
  typing?.('ssh pi\r')
  await vi.waitFor(() => expect(readSpec(tab.doc)?.shell).toBe('ssh:pi'))
  return tab
}

test('another ssh in front after the first is asked again, and an unknown one gives the tab back', async () => {
  const tab = await adopted()

  reached = { hostname: 'box.example.com', user: null, port: null }
  typing?.('exit; ssh box.example.com\r')
  await vi.waitFor(() => expect(readSpec(tab.doc)?.shell).toBe('pwsh'), { timeout: 2500 })
  expect(tab.running?.host).toBeNull()
})

test('a name cleared while it is a host gives the tab the local shell back as its name', async () => {
  const tab = await adopted()
  await renameTerminal(tab, 'mine')
  await renameTerminal(tab, '')
  expect(tab.name).toBe('PowerShell')
})

test('a split or duplicate of a local terminal is a terminal of its own, not the same words', async () => {
  const tab = await adopted()
  const { duplicateTab } = await import('../../src/lib/tab-strip/ops')
  duplicateTab(tab.id)
  const copy = workspace.tabs.at(-1)
  if (!copy || copy === tab) throw new Error('no copy')

  expect(copy.note).not.toBe(tab.note)
  expect(readSpec(copy.doc)).toMatchObject({ shell: 'ssh:pi', key: '' })
  expect(readSpec(copy.doc)?.via).toBeUndefined()
  expect(readSpec(tab.doc)?.via).toBe('pwsh')
})

test('a host reached by ssh in a local tab is kept as connected to lately', async () => {
  await adopted()
  await vi.waitFor(() =>
    expect(asked.find((one) => one.command === 'remote_keep')?.args).toMatchObject({
      kept: { about: { pi: { last: expect.any(Number) as number } } },
    }),
  )
})

test('an address no host has is looked up once, not every time ssh is asked after', async () => {
  const tab = await local()
  front = 'ssh'
  reached = { hostname: 'box.example.com', user: null, port: null }
  const lookups = () => asked.filter((one) => one.command === 'remote_hosts').length

  typing?.('ssh box.example.com\r')
  await vi.waitFor(() => expect(asked.some((one) => one.command === 'pty_ssh')).toBe(true))
  await new Promise((settle) => setTimeout(settle, 100))
  const after = lookups()
  typing?.('ls\r')
  await new Promise((settle) => setTimeout(settle, 1200))
  typing?.('ls\r')
  await new Promise((settle) => setTimeout(settle, 1200))
  expect(lookups()).toBe(after)
  expect(readSpec(tab.doc)?.shell).toBe('pwsh')
})

test('the prompt of the other machine landing while it is asked does not stop it', async () => {
  const tab = await local()
  front = 'ssh'
  reached = { hostname: 'pi', user: null, port: null }
  typing?.('ssh pi\r')
  await vi.waitFor(() => expect(asked.some((one) => one.command === 'pty_ssh')).toBe(true))
  channels.at(-1)?.onmessage?.(new TextEncoder().encode('\x1b]133;A\x07pi$ ').buffer)
  await vi.waitFor(() => expect(readSpec(tab.doc)?.shell).toBe('ssh:pi'))
})
