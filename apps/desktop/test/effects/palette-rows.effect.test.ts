import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { computed, root } from './runes.svelte'

const notes = new Map<string, string>()

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      case 'list_spaces':
        return [{ name: 'space', path: '/space' }]
      case 'read_tree':
        return {
          name: 'space',
          path: '/space',
          is_dir: true,
          modified: 0,
          created: 0,
          children: [],
        }
      default:
        return undefined
    }
  },
}))

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

Element.prototype.scrollIntoView = () => undefined

const { workspace } = await import('../../src/lib/workspace.svelte')
const { appCommands, blockRows, exportCommands } = await import('../../src/lib/commands')
const { default: Palette } = await import('../../src/lib/Palette.svelte')

async function typed() {
  await workspace.open('/space/One.md')
  const note = workspace.active?.note
  if (!note) throw new Error('nothing opened')

  note.live.edit([{ from: note.live.text.length, to: note.live.text.length, insert: ' more' }])
}

function derived<T>(of: () => T): T {
  let read: (() => T) | undefined
  const stop = root(() => {
    read = computed(of)
  })

  try {
    if (!read) throw new Error('the root ran nothing')
    return read()
  } finally {
    stop()
  }
}

let target: HTMLElement

beforeEach(() => {
  notes.clear()
  notes.set('/space/One.md', '# One')
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  workspace.tabs = []
  target.remove()
})

test('the command list is read without writing, mid-typing', async () => {
  expect(derived(() => appCommands().length)).toBeGreaterThan(50)

  await typed()

  expect(derived(() => appCommands().length)).toBeGreaterThan(50)
  expect(derived(() => exportCommands().length)).toBeGreaterThan(0)
})

test('the `/` menu is read without writing, mid-typing', async () => {
  await typed()

  expect(derived(() => blockRows().length)).toBeGreaterThan(10)
})

test('the palette opens on the commands, mid-typing', async () => {
  await typed()

  const made = mount(Palette, { target, props: { open: false } })
  flushSync()

  try {
    await (made as unknown as { showCommands(): Promise<void> }).showCommands()
    flushSync()

    expect(target.querySelector('input')?.value).toBe('>')
    expect(target.querySelectorAll('[role="option"]').length).toBeGreaterThan(10)
  } finally {
    void unmount(made, { outro: false })
  }
})
