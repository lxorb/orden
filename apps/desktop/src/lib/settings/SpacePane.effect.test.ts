import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The field on the page: loaded, focused when asked for, read-only for a reader, and
 *  nothing unwritten left behind when the settings close. The disk is stood in for; the
 *  store's own rules are instructions-field.test.ts. */

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writable: true,
  writes: [] as { path: string; after: string }[],
  made: [] as string[],
  heard: null as ((path: string, words: string) => void) | null,
}))

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  invoke: () => Promise.resolve(null),
}))
vi.mock('../sync.svelte', () => ({ sync: { nudge: vi.fn() } }))
vi.mock('../on-disk', () => ({ onDisk: (path: string) => Promise.resolve(disk.files.has(path)) }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => disk.writable }))
vi.mock('../link-index.svelte', () => ({
  links: {
    hearSaves: (hear: (path: string, words: string) => void) => {
      disk.heard = hear
      return () => (disk.heard = null)
    },
  },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: {
    activeSpace: { root: '/space' },
    spaces: [
      { id: 's', name: 'Plans', root: '/space' },
      { id: 'o', name: 'Other', root: '/other' },
    ],
    loadTree: vi.fn(() => Promise.resolve()),
    fileCame: vi.fn(() => Promise.resolve()),
  },
}))
vi.mock('../workspace/note-text', () => ({
  noteText: (_: unknown, path: string) => Promise.resolve(disk.files.get(path) ?? null),
  writeNoteText: (_: unknown, path: string, _before: string, after: string) => {
    disk.writes.push({ path, after })
    disk.files.set(path, after)
    return Promise.resolve()
  },
}))
vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, text: string) => {
    disk.made.push(path)
    disk.files.set(path, text)
    return Promise.resolve()
  },
}))

const { settings } = await import('../settings.svelte')
const { landing } = await import('./landing.svelte')
const SpacePane = (await import('./SpacePane.svelte')).default

const settled = () => new Promise((resolve) => setTimeout(resolve))

let target: HTMLElement
let close: (() => void) | undefined

async function shown() {
  const made = mount(SpacePane, { target })
  close = () => void unmount(made)
  flushSync()
  await settled()
  flushSync()
  const box = target.querySelector('textarea')
  if (!box) throw new Error('no field')
  return box
}

function typed(box: HTMLTextAreaElement, words: string) {
  box.value = words
  box.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

beforeEach(() => {
  disk.files.clear()
  disk.writes = []
  disk.made = []
  disk.writable = true
  settings.space = null
  landing.instructions = false
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

describe('Settings > Space', () => {
  test('shows what the file at the top of the space in front says', async () => {
    disk.files.set('/space/AGENTS.md', '# Rules')
    const box = await shown()
    expect(box.value).toBe('# Rules')
    expect(target.textContent).toContain('Plans')
  })

  test('is about the space it was asked for', async () => {
    disk.files.set('/other/AGENTS.md', '# Theirs')
    settings.space = '/other'
    const box = await shown()
    expect(box.value).toBe('# Theirs')
    expect(target.textContent).toContain('Other')
  })

  test('opened and closed, it makes no file', async () => {
    await shown()
    close?.()
    close = undefined
    await settled()
    expect(disk.made).toEqual([])
    expect(disk.writes).toEqual([])
  })

  test('takes the caret when the hint asked for it, and only then', async () => {
    let box = await shown()
    expect(document.activeElement).not.toBe(box)
    close?.()

    landing.instructions = true
    box = await shown()
    expect(document.activeElement).toBe(box)
    expect(landing.instructions).toBe(false)
  })

  test('words typed and the settings closed at once are written', async () => {
    disk.files.set('/space/AGENTS.md', '# Rules')
    const box = await shown()
    typed(box, '# Rules\n- tea')
    close?.()
    close = undefined
    await settled()
    await settled()
    expect(disk.files.get('/space/AGENTS.md')).toBe('# Rules\n- tea')
  })

  test('words typed where there is no file make it, through the app’s write', async () => {
    const box = await shown()
    typed(box, '# New')
    box.dispatchEvent(new Event('blur'))
    await settled()
    await settled()
    expect(disk.made).toEqual(['/space/AGENTS.md'])
  })

  test('a reader reads', async () => {
    disk.writable = false
    disk.files.set('/space/AGENTS.md', '# Theirs')
    const box = await shown()
    expect(box.readOnly).toBe(true)
    typed(box, 'mine')
    box.dispatchEvent(new Event('blur'))
    await settled()
    expect(disk.writes).toEqual([])
  })

  test('a file that arrives from sync or an agent appears', async () => {
    const box = await shown()
    disk.heard?.('/space/AGENTS.md', '# Arrived')
    flushSync()
    expect(box.value).toBe('# Arrived')
    disk.heard?.('/space/sub/AGENTS.md', '# Elsewhere')
    flushSync()
    expect(box.value).toBe('# Arrived')
  })
})
