import { flushSync } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { idle } from './settle'

const asked: { command: string; args: Record<string, unknown> }[] = []
const machine = { busy: false, here: '/home/me' as string | null }
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    if (command === 'terminal_shells') return Promise.resolve([{ id: 'bash', name: 'Bash' }])
    if (command === 'remote_hosts') {
      return Promise.resolve({ config: [{ id: 'pi', also: [], hostname: '10.0.0.5' }], kept: {}, file: null })
    }
    if (command === 'pty_spawn') return Promise.resolve({ pid: 1, fresh: true })
    if (command === 'pty_busy') return Promise.resolve(machine.busy)
    if (command === 'pty_folder') return Promise.resolve(machine.here)
    if (command === 'read_tree' || command === 'file_stamp') return Promise.reject(new Error('outside the spaces'))
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
let typing: ((data: string) => void) | null = null
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
    onTitleChange = () => undefined
    onResize = () => undefined
    attachCustomKeyEventHandler = () => undefined
    open = () => undefined
    resize = () => undefined
    write(_data: unknown, then?: () => void) {
      if (then) setTimeout(then, 0)
    }
    focus = () => undefined
    dispose = () => undefined
    clear = () => undefined
    hasSelection = () => false
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
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
})
const { workspace } = await import('../../src/lib/workspace/src/api')
const { writeSpec } = await import('../../src/lib/terminal/src/spec')
const { sessionOf, goTo } = await import('../../src/lib/terminal/src/sessions.svelte')
const { shells } = await import('../../src/lib/terminal/src/shells.svelte')
const typed = () => asked.filter((one) => one.command === 'pty_write').map((one) => String(one.args.data))
let place: HTMLElement
beforeEach(() => {
  asked.length = 0
  Object.assign(machine, { busy: false, here: '/home/me' })
  shells.restoring = true
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/work' }]
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
const PROMPT = Array.from('\x1b]133;A\x1b\\$ ', (one) => one.charCodeAt(0))
async function prompted() {
  const out = new ArrayBuffer(PROMPT.length)
  new Uint8Array(out).set(PROMPT)
  channels.at(-1)?.onmessage?.(out)
  await idle(20)
}
async function shell(spec: string, key: string, spawned = true, prompt = true) {
  workspace.openUnsaved('terminal', writeSpec({ shell: spec, folder: null, key, name: null }), 'Shell')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  await sessionOf(tab).attach(place, false)
  if (spawned) await vi.waitFor(() => expect(asked.some((one) => one.command === 'pty_spawn')).toBe(true))
  await idle(20)
  if (spawned && prompt) await prompted()
  asked.length = 0
  return tab
}
test('a shell resting at its prompt goes to the folder the explorer shows, quoted for it (#2274)', async () => {
  const tab = await shell('bash', 'k-go')
  expect(await goTo(tab.id, "/work/Plans B/it's")).toBe(true)
  await vi.waitFor(() => expect(typed()).toEqual(["cd '/work/Plans B/it'\\''s'\r"]))
})
test('a folder outside every space gets the cd too, though the app reads no file there (#2274)', async () => {
  const tab = await shell('bash', 'k-out')
  expect(await goTo(tab.id, '/etc/ssl')).toBe(true)
  await vi.waitFor(() => expect(typed()).toEqual(['cd /etc/ssl\r']))
})
test('after a program ends and its prompt comes back, the shell is sent again (#2274)', async () => {
  const tab = await shell('bash', 'k-after')
  typing?.('make\r')
  expect(await goTo(tab.id, '/work')).toBe(false)
  await prompted()
  expect(await goTo(tab.id, '/work')).toBe(true)
  expect(await goTo(tab.id, '/srv')).toBe(false)
  await prompted()
  expect(await goTo(tab.id, '/srv')).toBe(true)
  await idle(20)
  expect(typed()).toEqual(['make\r', 'cd /work\r', 'cd /srv\r'])
})
test('nothing is typed while a builtin or cmdlet runs inside the shell itself, with no program under it (#2274)', async () => {
  const bash = await shell('bash', 'k-read')
  typing?.('read name\r')
  expect(await goTo(bash.id, '/work')).toBe(false)
  typing?.('while true; do :; done\r')
  expect(await goTo(bash.id, '/work')).toBe(false)
  const pwsh = await shell('pwsh', 'k-sleep')
  typing?.('Start-Sleep 15\r')
  expect(await goTo(pwsh.id, '/work')).toBe(false)
  await prompted()
  expect(await goTo(pwsh.id, '/work')).toBe(true)
  await idle(20)
  expect(typed().at(-1)).toBe('Set-Location -LiteralPath /work\r')
})
test('a shell that has never shown a prompt mark falls back to asking whether a program runs under it (#2274)', async () => {
  const tab = await shell('zsh', 'k-zsh', true, false)
  machine.busy = true
  expect(await goTo(tab.id, '/work')).toBe(false)
  machine.busy = false
  expect(await goTo(tab.id, '/work')).toBe(true)
  await idle(20)
  expect(typed()).toEqual(['cd /work\r'])
})
test('nothing is typed into a shell already there, running a program or holding a half-typed line (#2274)', async () => {
  const tab = await shell('bash', 'k-stay')
  expect(await goTo(tab.id, '/home/me')).toBe(false)
  machine.busy = true
  expect(await goTo(tab.id, '/work')).toBe(false)
  machine.busy = false
  typing?.('git sta')
  expect(await goTo(tab.id, '/work')).toBe(false)
  typing?.('\x15')
  await idle(20)
  expect(typed()).toEqual(['git sta', '\x15'])
  expect(await goTo(tab.id, '/work')).toBe(true)
})
test('a remote shell is never sent anywhere, nor a tab with no shell (#2274)', async () => {
  const tab = await shell('ssh:pi', 'r-go', false)
  expect(await goTo(tab.id, '/work')).toBe(false)
  expect(await goTo('no-such-tab', '/work')).toBe(false)
  await idle(20)
  expect(typed()).toEqual([])
})
