import { beforeEach, describe, expect, test, vi } from 'vitest'

const calls: { command: string; args: Record<string, unknown> }[] = []
let engineTells = true

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args: args ?? {} })
    return Promise.resolve(command === 'page_carry' ? engineTells : undefined)
  },
}))

const { workspace } = await import('../workspace.svelte')
await import('../internal/work')
const { carriedToPages, carryToPages, carryingOf, droppedOnPage, leftPage, overPage } =
  await import('./carry-in')

const SHORTCUT = '[InternetShortcut]\nURL=https://example.com/a\n'

const look = {
  isFolder: (path: string) => path.endsWith('/Folder'),
  locked: (path: string) => path.includes('Locked'),
  read: (path: string) => Promise.resolve(path.endsWith('.url') ? SHORTCUT : null),
}

const BOX = { left: 100, top: 50, width: 800, height: 600, x: 100, y: 50, right: 900, bottom: 650 }

const pane = { dataset: { pane: 'p' }, getBoundingClientRect: () => BOX }
const hole = {
  closest: () => pane,
  getBoundingClientRect: () => BOX,
} as unknown as HTMLElement

const prevented = new WeakMap<DragEvent, ReturnType<typeof vi.fn>>()

function dragAt(x: number, y: number, types = ['text/orden-path', 'text/orden-paths']) {
  const prevent = vi.fn()
  const event = {
    clientX: x,
    clientY: y,
    dataTransfer: { types, dropEffect: 'none' },
    preventDefault: prevent,
  } as unknown as DragEvent
  prevented.set(event, prevent)
  return event
}

const preventedOf = (event: DragEvent) => prevented.get(event)

async function settled() {
  for (let round = 0; round < 20; round++) await new Promise((done) => setTimeout(done, 0))
}

const told = () => calls.filter((one) => one.command.startsWith('page_carry'))

beforeEach(async () => {
  carriedToPages()
  await settled()
  calls.length = 0
  engineTells = true
  vi.restoreAllMocks()
})

describe('what a drag of rows hands a page', () => {
  test('a note and a PDF as their files, a web note as its address, never a folder or a locked note', async () => {
    const carrying = await carryingOf(
      ['/s/Idea.md', '/s/Folder', '/s/Paper.pdf', '/s/Site.url', '/s/Locked.md'],
      look,
    )
    expect(carrying).toEqual({
      files: ['/s/Idea.md', '/s/Paper.pdf'],
      addresses: ['https://example.com/a'],
    })
  })

  test('the rows are carried at the start and let go of at the end, in that order', async () => {
    carryToPages(['/s/Idea.md'], look)
    carriedToPages()
    await settled()
    expect(told()).toEqual([
      { command: 'page_carry', args: { files: ['/s/Idea.md'], addresses: [] } },
      { command: 'page_carry_end', args: {} },
    ])
  })

  test('a drag of folders alone carries nothing', async () => {
    carryToPages(['/s/Folder'], look)
    await settled()
    expect(told()).toEqual([])
  })
})

describe('a page the shell tells of the drag itself', () => {
  test('hears it enter at its own point, move, and drop, once each step is answered', async () => {
    carryToPages(['/s/Idea.md'], look)
    await settled()

    const over = dragAt(300, 250)
    overPage('a', hole, over, 2)
    expect(preventedOf(over)).toHaveBeenCalled()
    expect(over.dataTransfer?.dropEffect).toBe('copy')
    await settled()
    overPage('a', hole, dragAt(310, 250), 2)
    overPage('a', hole, dragAt(320, 250), 2)
    await settled()
    const drop = dragAt(320, 250)
    droppedOnPage('a', hole, drop, 2)
    expect(preventedOf(drop)).toHaveBeenCalled()
    await settled()

    expect(told().slice(1)).toEqual([
      { command: 'page_carry_over', args: { tab: 'a', x: 100, y: 100, phase: 'over' } },
      { command: 'page_carry_over', args: { tab: 'a', x: 110, y: 100, phase: 'over' } },
      { command: 'page_carry_over', args: { tab: 'a', phase: 'drop', x: 110, y: 100 } },
    ])
  })

  test('hears it leave, and only once it was over the page', async () => {
    carryToPages(['/s/Idea.md'], look)
    await settled()
    leftPage('a')
    overPage('a', hole, dragAt(300, 250), 1)
    await settled()
    leftPage('a')
    leftPage('a')
    await settled()
    expect(told().map((one) => one.args.phase)).toEqual([undefined, 'over', 'leave'])
  })

  test('leaves the pane its edges, where the row splits it', async () => {
    vi.spyOn(workspace, 'canLand').mockReturnValue(true)
    carryToPages(['/s/Idea.md'], look)
    await settled()
    const edge = dragAt(BOX.left + 4, 300)
    overPage('a', hole, edge, 1)
    droppedOnPage('a', hole, edge, 1)
    await settled()
    expect(preventedOf(edge)).not.toHaveBeenCalled()
    expect(told().slice(1)).toEqual([])
  })

  test('takes rows of the file explorer as it takes rows of the file list', async () => {
    carryToPages(['/home/me/Downloads/scan.pdf'], look)
    await settled()
    const rows = dragAt(300, 250, ['text/orden-explorer', 'text/plain'])
    overPage('a', hole, rows, 1)
    expect(preventedOf(rows)).toHaveBeenCalled()
    await settled()
    const drop = dragAt(300, 250, ['text/orden-explorer', 'text/plain'])
    droppedOnPage('a', hole, drop, 1)
    expect(preventedOf(drop)).toHaveBeenCalled()
    await settled()
    expect(told().map((one) => one.args.phase)).toEqual([undefined, 'over', 'drop'])
  })

  test('takes nothing but rows of the file list', async () => {
    carryToPages(['/s/Idea.md'], look)
    await settled()
    const words = dragAt(300, 250, ['text/plain'])
    overPage('a', hole, words, 1)
    expect(preventedOf(words)).not.toHaveBeenCalled()
  })
})

describe('a page the system hands the drag', () => {
  test('is never told of it by the shell', async () => {
    engineTells = false
    carryToPages(['/s/Idea.md'], look)
    await settled()
    const over = dragAt(300, 250)
    overPage('a', hole, over, 1)
    droppedOnPage('a', hole, over, 1)
    await settled()
    expect(preventedOf(over)).not.toHaveBeenCalled()
    expect(told().map((one) => one.command)).toEqual(['page_carry'])
  })
})
