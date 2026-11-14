import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const asked: string[] = []
let output: { onmessage: ((message: unknown) => void) | null } | null = null
let busy = true
const files = new Map<string, unknown>()

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  platform: () => 'windows',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push(command === 'pty_write' ? `pty_write ${JSON.stringify(args.data)}` : command)
    const at = `${String(args.space)}/${String(args.key)}`
    if (command === 'pty_spawn') {
      output = args.output as typeof output
      return Promise.resolve({ pid: 1 })
    }
    if (command === 'pty_busy') return Promise.resolve(busy)
    if (command === 'terminal_history_read') return Promise.resolve(files.get(at) ?? null)
    if (command === 'terminal_history_write') files.set(at, args.history)
    return Promise.resolve(null)
  },
}))

vi.mock('../../src/lib/crate/src/native', () => ({
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

const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { sessionOf } = await import('../../src/lib/terminal/src/sessions.svelte')
const { shells } = await import('../../src/lib/terminal/src/shells.svelte')
const { flushSync } = await import('svelte')
const { written } = await import('../../src/lib/parting')

type Opened = ReturnType<typeof sessionOf>

async function opened(key: string, shell = 'pwsh'): Promise<Opened> {
  const words = JSON.stringify({ shell, folder: null, key })
  const doc = new NoteDoc(
    { kind: 'terminal', path: null, name: 'PowerShell', text: words, dirty: false },
    () => undefined,
  )
  const tab = new Tab(doc, 'pane')
  workspace.tabs = [...workspace.tabs, tab]
  const place = document.createElement('div')
  document.body.append(place)

  const session = sessionOf(tab)
  await session.attach(place, false)
  await vi.waitFor(() => expect(asked).toContain('pty_spawn'))
  return session
}

async function printed(session: Opened, text: string) {
  output?.onmessage?.(Uint8Array.from(text, (one) => one.charCodeAt(0)).buffer)
  await new Promise<void>((settle) => session.term.write('', settle))
  await new Promise<void>((settle) => session.term.write('', settle))
}

const PROGRAM_ON = '\x1b[?1003h\x1b[?1004h\x1b[?1h'
const PROMPT = '\x1b]133;A\x1b\\\x1b]9;9;C:\\work\x1b\\PS C:\\work> '

beforeEach(() => {
  asked.length = 0
  files.clear()
  busy = true
  output = null
  shells.setRestoring(true)
})

afterEach(async () => {
  workspace.tabs = []
  flushSync()
  await written()
  document.body.innerHTML = ''
})

test('the prompt after a program that left the mouse reported reports nothing', async () => {
  const session = await opened('m1')

  await printed(session, `${PROGRAM_ON}drawing...`)
  expect(session.term.modes.mouseTrackingMode, 'while it runs').toBe('any')

  await printed(session, `^C\r\n${PROMPT}`)
  expect(session.term.modes.mouseTrackingMode, 'at the prompt').toBe('none')
  expect(session.term.modes.sendFocusMode).toBe(false)
  expect(session.term.modes.applicationCursorKeysMode).toBe(false)
  expect(
    session.term.buffer.active.getLine(session.term.buffer.active.cursorY)?.translateToString(true),
  ).toBe('PS C:\\work> ')
})

test('a program still running keeps what it asked for', async () => {
  const session = await opened('m2')
  await printed(session, `${PROMPT}claude\r\n`)
  await printed(session, `${PROGRAM_ON}the program's screen`)

  await new Promise((settle) => setTimeout(settle, 400))
  expect(asked).not.toContain('pty_busy')
  expect(session.term.modes.mouseTrackingMode).toBe('any')
  expect(session.term.modes.applicationCursorKeysMode).toBe(true)
})

test('a shell that marks no prompts is asked whether it is in front again', async () => {
  const session = await opened('m3', '/bin/zsh')
  await printed(session, `${PROGRAM_ON}vim`)

  busy = true
  await new Promise((settle) => setTimeout(settle, 400))
  expect(asked).toContain('pty_busy')
  expect(session.term.modes.mouseTrackingMode, 'the program is in front').toBe('any')

  busy = false
  await printed(session, '\r\n% ')
  await vi.waitFor(() => expect(session.term.modes.mouseTrackingMode).toBe('none'))
  expect(session.term.modes.sendFocusMode).toBe(false)
  expect(session.term.modes.applicationCursorKeysMode).toBe(true)
})

test('a screen is written down without its modes, and one that has them is put back without', async () => {
  const session = await opened('m4')
  await printed(session, `${PROMPT}claude\r\n${PROGRAM_ON}a program's output`)
  session.remember()
  await written()

  const kept = files.get('null/m4') as { text: string } | undefined
  expect(kept?.text).toContain("a program's output")
  expect(kept?.text).not.toContain('\x1b[?1003h')
  expect(kept?.text).not.toContain('\x1b[?1004h')

  workspace.tabs = []
  flushSync()
  asked.length = 0
  files.set('null/m5', { cols: 80, rows: 24, at: 1, text: `old output${PROGRAM_ON}\x1b[?2004h` })
  const back = await opened('m5')
  expect(back.term.modes.mouseTrackingMode).toBe('none')
  expect(back.term.modes.sendFocusMode).toBe(false)
  expect(back.term.modes.applicationCursorKeysMode).toBe(false)
  expect(back.term.modes.bracketedPasteMode).toBe(false)
})
