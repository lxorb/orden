import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const typed: string[] = []
const carried: Record<string, unknown>[] = []
let refuse = false

const PATH = '/home/emil/.cache/nib/images/nib-0011223344556677.png'
const KEPT = '/home/emil/.cache/ch.emilvinu.nib/images/nib-8899aabbccddeeff.png'
const kept: Record<string, unknown>[] = []
let outside: string[] = []

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'pty_write') typed.push(String(args.data))
    if (command === 'pty_spawn') return Promise.resolve({ pid: 1 })
    if (command === 'pty_busy') return Promise.resolve(false)
    if (command === 'remote_hosts') {
      return Promise.resolve({
        config: [{ id: 'pi', also: [], hostname: '10.0.0.5' }],
        kept: { own: [], about: {}, order: [], groups: [] },
        file: null,
      })
    }
    if (command === 'local_image') {
      kept.push(args)
      return refuse ? Promise.reject(new Error('disk full')) : Promise.resolve(KEPT)
    }
    if (command === 'dropped_paths') return Promise.resolve(outside)
    if (command === 'remote_image') {
      carried.push(args)
      return refuse ? Promise.reject(new Error('Permission denied')) : Promise.resolve(PATH)
    }
    return Promise.resolve(null)
  },
}))

vi.mock('../../src/lib/native', () => ({
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null
  },
  invoke: () => Promise.resolve(null),
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = () => undefined
    disconnect = () => undefined
  },
)
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
}))
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { load: () => Promise.resolve([]) },
})

let clipboard: { picture?: Uint8Array; text?: string } = {}
const reads = { count: 0 }

const pictureFile = (bytes: Uint8Array) =>
  ({
    type: 'image/png',
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  }) as unknown as File

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: {
    read: () => {
      reads.count += 1
      const { picture } = clipboard
      return Promise.resolve(
        picture
          ? [{ types: ['image/png'], getType: () => Promise.resolve(pictureFile(picture)) }]
          : [],
      )
    },
    readText: () => Promise.resolve(clipboard.text ?? ''),
    writeText: () => Promise.resolve(),
  },
})

const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { sessionOf } = await import('../../src/lib/terminal/sessions.svelte')
const { openRemote } = await import('../../src/lib/remote/open')
const { shells } = await import('../../src/lib/terminal/shells.svelte')
const { busy } = await import('../../src/lib/busy.svelte')
const { flushSync } = await import('svelte')
const { written } = await import('../../src/lib/parting')

type Opened = ReturnType<typeof sessionOf>

const heard: string[] = []
const hear = (event: KeyboardEvent) => {
  heard.push(event.key)
}

let place: HTMLElement

async function local(key: string): Promise<Opened> {
  const words = JSON.stringify({ shell: '/bin/bash', folder: null, key })
  const doc = new NoteDoc(
    { kind: 'terminal', path: null, name: 'bash', text: words, dirty: false },
    () => undefined,
  )
  const tab = new Tab(doc, 'pane')
  workspace.tabs = [...workspace.tabs, tab]
  return drawn(sessionOf(tab))
}

async function remote(): Promise<Opened> {
  await openRemote('pi')
  const tab = workspace.tabs.at(-1)
  if (!tab) throw new Error('no tab')
  return drawn(sessionOf(tab))
}

async function drawn(session: Opened): Promise<Opened> {
  await session.attach(place, false)
  await vi.waitFor(() => expect(session.term.textarea).toBeDefined())
  await new Promise((settle) => setTimeout(settle, 10))
  return session
}

function press(session: Opened, letter: string, held: 'alt' | 'ctrl') {
  session.term.textarea?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: letter,
      code: `Key${letter.toUpperCase()}`,
      keyCode: letter.toUpperCase().charCodeAt(0),
      altKey: held === 'alt',
      ctrlKey: held === 'ctrl',
      bubbles: true,
      cancelable: true,
    }),
  )
  flushSync()
}

function paste(session: Opened, what: { text?: string; picture?: Uint8Array }) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? (what.text ?? '') : ''),
      files: what.picture ? [pictureFile(what.picture)] : [],
    },
  })
  session.term.textarea?.dispatchEvent(event)
}

beforeEach(() => {
  typed.length = 0
  carried.length = 0
  kept.length = 0
  outside = []
  heard.length = 0
  reads.count = 0
  refuse = false
  clipboard = {}
  busy.clear()
  shells.restoring = false
  workspace.panes.collapse()
  workspace.tabs = []
  place = document.createElement('div')
  document.body.append(place)
  window.addEventListener('keydown', hear)
})

afterEach(async () => {
  window.removeEventListener('keydown', hear)
  workspace.tabs = []
  flushSync()
  await written()
  document.body.innerHTML = ''
})

test('a local terminal hands Alt+V to the shell as ESC and the letter, reading nothing', async () => {
  clipboard = { picture: new Uint8Array([1, 2, 3]) }
  const session = await local('img-1')

  press(session, 'v', 'alt')
  press(session, 'j', 'alt')
  press(session, 'v', 'ctrl')
  await vi.waitFor(() => expect(typed.join('')).toBe('\x1bv\x1bj\x16'))
  expect(heard).toEqual([])
  expect(reads.count).toBe(0)
  expect(carried).toEqual([])
})

test('in a remote terminal Alt+V carries the clipboard’s picture over and pastes its path', async () => {
  clipboard = { picture: new Uint8Array([1, 2, 3]) }
  const session = await remote()

  press(session, 'v', 'alt')
  await vi.waitFor(() => expect(typed.join('')).toBe(PATH))
  expect(carried).toEqual([{ host: 'pi', kind: 'png', bytes: new Uint8Array([1, 2, 3]) }])
  expect(heard).toEqual([])
})

test('so does Ctrl+V, Claude Code’s key off Windows', async () => {
  clipboard = { picture: new Uint8Array([4]) }
  const session = await remote()

  press(session, 'v', 'ctrl')
  await vi.waitFor(() => expect(typed.join('')).toBe(PATH))
  expect(carried).toHaveLength(1)
})

test('with no picture on the clipboard the key goes to the shell as it would have', async () => {
  clipboard = { text: 'words' }
  const session = await remote()

  press(session, 'v', 'alt')
  press(session, 'v', 'ctrl')
  await vi.waitFor(() => expect(typed.join('')).toBe('\x1bv\x16'))
  expect(carried).toEqual([])
})

test('a paste with a picture and no text is carried over; one with text is the text', async () => {
  const session = await remote()

  paste(session, { picture: new Uint8Array([1, 2, 3]) })
  await vi.waitFor(() => expect(typed.join('')).toBe(PATH))
  expect(carried).toHaveLength(1)

  typed.length = 0
  paste(session, { text: 'ls', picture: new Uint8Array([1]) })
  await vi.waitFor(() => expect(typed.join('')).toBe('ls'))
  expect(carried).toHaveLength(1)
})

test('a picture pasted into a local terminal is kept on this computer and its path pasted', async () => {
  const session = await local('img-2')

  paste(session, { picture: new Uint8Array([1, 2, 3]) })
  await vi.waitFor(() => expect(typed.join('')).toBe(KEPT))
  expect(kept).toEqual([{ kind: 'png', bytes: new Uint8Array([1, 2, 3]) }])
  expect(carried).toEqual([])

  typed.length = 0
  paste(session, { text: 'ls', picture: new Uint8Array([1]) })
  await vi.waitFor(() => expect(typed.join('')).toBe('ls'))
  expect(kept).toHaveLength(1)
})

test('so is one pasted from the menu when the clipboard holds no text', async () => {
  clipboard = { picture: new Uint8Array([7]) }
  const session = await local('img-3')

  session.term.textarea?.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
  )
  flushSync()
  const { menu } = await import('../../src/lib/menu.svelte')
  const row = menu.items.find((one) => one !== null && 'label' in one && one.label === 'Paste')
  if (!row || !('run' in row)) throw new Error('no Paste row')
  row.run()
  await vi.waitFor(() => expect(typed.join('')).toBe(KEPT))
  expect(kept).toEqual([{ kind: 'png', bytes: new Uint8Array([7]) }])
})

test('a picture this computer could not keep says so, and nothing is pasted', async () => {
  refuse = true
  const session = await local('img-4')

  paste(session, { picture: new Uint8Array([1]) })
  await vi.waitFor(() => expect(busy.trouble).toBe('Could not send the image'))
  expect(typed).toEqual([])
})

function drop(session: Opened, transfer: Partial<DataTransfer>): boolean {
  const host = session.term.element?.parentElement ?? place
  const over = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(over, 'dataTransfer', { value: { ...transfer, dropEffect: 'none' } })
  host.dispatchEvent(over)
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  host.dispatchEvent(event)
  return over.defaultPrevented && event.defaultPrevented
}

const named = (name: string, type: string) => ({ name, type }) as unknown as File

test('files dropped from another app on a local terminal are their paths at the prompt', async () => {
  const session = await local('img-5')
  outside = ['/home/emil/Pictures/shot one.png', '/home/emil/notes.txt']

  const files = [named('shot one.png', 'image/png'), named('notes.txt', 'text/plain')]
  expect(drop(session, { types: ['Files'], files: files as unknown as FileList })).toBe(true)
  await vi.waitFor(() =>
    expect(typed.join('')).toBe("'/home/emil/Pictures/shot one.png' /home/emil/notes.txt"),
  )
  expect(kept).toEqual([])
})

test('rows of the file explorer dropped on a local terminal are their paths too', async () => {
  const session = await local('img-6')

  const rows = JSON.stringify(['/etc/hosts', '/tmp/a b'])
  const transfer = {
    types: ['text/nib-explorer', 'text/plain'],
    getData: (type: string) => (type === 'text/nib-explorer' ? rows : ''),
    files: [] as unknown as FileList,
  }
  expect(drop(session, transfer)).toBe(true)
  await vi.waitFor(() => expect(typed.join('')).toBe("/etc/hosts '/tmp/a b'"))
})

test('a picture dropped from another app on a remote terminal is carried over', async () => {
  const session = await remote()

  const picture = Object.assign(pictureFile(new Uint8Array([5])), { name: 'shot.png' })
  expect(drop(session, { types: ['Files'], files: [picture] as unknown as FileList })).toBe(true)
  await vi.waitFor(() => expect(typed.join('')).toBe(PATH))
  expect(carried).toEqual([{ host: 'pi', kind: 'png', bytes: new Uint8Array([5]) }])
})

test('a host that refuses the picture says so across the top, and nothing is pasted', async () => {
  refuse = true
  clipboard = { picture: new Uint8Array([1]) }
  const session = await remote()

  press(session, 'v', 'alt')
  await vi.waitFor(() => expect(busy.trouble).toBe('Could not send the image'))
  expect(typed).toEqual([])
})
