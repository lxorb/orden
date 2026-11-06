import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writable: true,
  writes: [] as { path: string; after: string }[],
  made: [] as string[],
  reads: 0,
  tabs: null as (() => unknown) | null,
  reactive: false,
  heard: null as ((path: string, words: string) => void) | null,
}))

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  invoke: () => Promise.resolve(null),
}))
vi.mock('../sync.svelte', () => ({ sync: { nudge: vi.fn() } }))
vi.mock('../on-disk', () => ({
  onDisk: (path: string) => Promise.resolve(disk.files.has(path) || !path.endsWith('.md')),
}))
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
  noteText: (_: unknown, path: string) => {
    disk.reads++
    if (disk.reactive) void disk.tabs?.()
    return Promise.resolve(disk.files.get(path) ?? null)
  },
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
const { settleUp, stillWriting } = await import('../parting')
disk.tabs = () => settings.section
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
  settings.landsOnField = false
  disk.reads = 0
  disk.reactive = false
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

    settings.landsOnField = true
    box = await shown()
    expect(document.activeElement).toBe(box)
    expect(settings.landsOnField).toBe(false)
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

  test('the tabs changing behind it neither reads the file again nor takes the words typed', async () => {
    disk.reactive = true
    disk.files.set('/space/AGENTS.md', '# Rules')
    const box = await shown()
    typed(box, '# Rules, typing')
    const reads = disk.reads

    settings.section = settings.section === 'space' ? 'general' : 'space'
    flushSync()
    await settled()
    flushSync()

    expect(disk.reads).toBe(reads)
    expect(box.value).toBe('# Rules, typing')
    expect(target.querySelector('textarea')).toBe(box)
  })

  test('a window going takes the words typed with it, and waits for them', async () => {
    disk.files.set('/space/AGENTS.md', '# Rules')
    const box = await shown()
    typed(box, '# Rules, last keys')

    settleUp()
    expect(stillWriting()).toBe(true)
    await settled()
    await settled()
    expect(disk.files.get('/space/AGENTS.md')).toBe('# Rules, last keys')
  })

  test('a space no longer on the list locks the field and is not made again', async () => {
    settings.space = '/gone'
    const box = await shown()
    expect(box.readOnly).toBe(true)
    typed(box, '# Back from the dead')
    box.dispatchEvent(new Event('blur'))
    await settled()
    expect(disk.made).toEqual([])
  })

  test('the file made tells the listing of the space it is in, not the one now asked for', async () => {
    const { workspace } = await import('../workspace.svelte')
    // eslint-disable-next-line @typescript-eslint/unbound-method -- a mock, only ever read
    const reads = vi.mocked(workspace.loadTree)
    reads.mockClear()
    const box = await shown()
    typed(box, '# New')
    settings.space = '/other'
    flushSync()
    await settled()
    await settled()
    expect(disk.made).toEqual(['/space/AGENTS.md'])
    expect(reads).toHaveBeenCalled()
  })
})
