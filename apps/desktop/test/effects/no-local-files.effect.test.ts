import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const opened: string[] = []

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'read_note' && typeof args?.path === 'string') opened.push(args.path)
    return undefined
  },
}))

const { appCommands } = await import('../../src/lib/commands')
const { guardDrops } = await import('../../src/lib/drops')
const { SHORTCUTS } = await import('../../src/lib/shortcuts/registry')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')

beforeEach(() => {
  opened.length = 0
})

test('there is no Open file to press, in the palette or on a key', () => {
  const rows = appCommands()
  expect(rows.map((one) => one.id)).not.toContain('open')
  expect(rows.map((one) => one.label)).not.toContain('Open file')

  expect(SHORTCUTS.map((one) => one.id)).not.toContain('app.open')
  expect(SHORTCUTS.map((one) => one.label())).not.toContain('Open file')
})

test('Ctrl+O opens the palette on the notes, and nothing else', () => {
  const asked: string[] = []
  const nothing = () => undefined
  const context = {
    view: undefined,
    palette: (mode?: 'commands') => void asked.push(mode ?? 'notes'),
    fullscreen: nothing,
  }

  const handler = (event: KeyboardEvent) => void shortcuts.handle(event, context)
  window.addEventListener('keydown', handler)
  try {
    const press = new KeyboardEvent('keydown', {
      key: 'o',
      code: 'KeyO',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(press)

    expect(asked).toEqual(['notes'])
    expect(press.defaultPrevented).toBe(true)
    expect(opened).toEqual([])
  } finally {
    window.removeEventListener('keydown', handler)
  }
})

function drag(type: 'dragover' | 'drop', on: Element, types: string[]): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  const items = types.includes('Files') ? [{ kind: 'file', type: 'text/markdown' }] : []
  const transfer = { types, dropEffect: 'copy', files: [], items }
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  on.dispatchEvent(event)
  return event
}

let stop: (() => void) | undefined
let somewhere: HTMLElement

beforeEach(() => {
  stop = guardDrops()
  somewhere = document.createElement('div')
  document.body.append(somewhere)
})

afterEach(() => {
  stop?.()
  somewhere.remove()
})

test('a file let go where nothing takes it is not opened in place of the app', () => {
  const over = drag('dragover', somewhere, ['Files'])
  expect(over.defaultPrevented).toBe(true)
  expect(over.dataTransfer?.dropEffect).toBe('none')

  const dropped = drag('drop', somewhere, ['Files'])
  expect(dropped.defaultPrevented).toBe(true)
  expect(opened).toEqual([])
})

test('while a surface that takes files keeps them', () => {
  const list = document.createElement('div')
  list.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  })
  somewhere.append(list)

  expect(drag('dragover', list, ['Files']).dataTransfer?.dropEffect).toBe('copy')
})

test('and a drag that carries no file is left alone', () => {
  const over = drag('dragover', somewhere, ['text/plain'])
  expect(over.defaultPrevented).toBe(false)
  expect(over.dataTransfer?.dropEffect).toBe('copy')
})
