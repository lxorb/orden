import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A PDF in a space somebody shared with this account to be read.
 *
 *  Opening a PDF anywhere else turns it into its page note: a `.pages` file is
 *  written beside it and the paper is renamed in under that note (from-pdf.ts). In a
 *  space that may not be written that is two changes the sync refuses on every pass,
 *  made by nothing more than a click on the row. So there the PDF opens as itself,
 *  its pages held in memory and nothing on the disk touched.
 *
 *  The disk is a map; see test/disk.ts. */

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))
const readOnly = vi.hoisted(() => new Set<string>())

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

vi.mock('../sharing.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharing.svelte')>()),
  canWriteAt: (path: string) =>
    ![...readOnly].some((root) => path === root || path.startsWith(`${root}/`)),
}))

/** Node has no pdf.js: every paper here is two pages, A4 and Letter. */
vi.mock('../pdf/document', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/document')>()),
  pageSizes: () =>
    Promise.resolve([
      { width: 794, height: 1123 },
      { width: 816, height: 1056 },
    ]),
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')

const ROOT = '/theirs'
const PAPER = `${ROOT}/paper.pdf`
const NOTE = `${ROOT}/paper.pages`

/** The page note an older build wrote beside the paper, which opening the paper in a
 *  space that may be written takes in, moving the paper under it. */
const BESIDE = JSON.stringify({
  nodes: [
    {
      id: 'p1',
      type: 'file',
      file: 'paper.pdf',
      subpath: '#page=1',
      x: -397,
      y: 0,
      width: 794,
      height: 1123,
    },
  ],
  edges: [],
  nib: { version: 1, pages: [{ id: 'p1', paper: 'a4', pattern: 'blank' }] },
})

function current(): import('../../../test/disk').Disk {
  if (!disk.current) throw new Error('no disk')
  return disk.current
}

/** What the disk was asked to change: a write, a rename or a delete. */
const changes = () =>
  current().sent.filter((one) => /^(write_note|rename_note|delete_note|trash_item) /.test(one))

/** A sitting from before papers opened as page notes: one tab of kind `pdf`. */
function sitting() {
  return {
    frame: {
      kind: 'pane' as const,
      pane: {
        id: 'p1',
        active: 0,
        linked: false,
        tabs: [
          {
            kind: 'pdf' as const,
            path: PAPER,
            name: 'paper.pdf',
            doc: '',
            dirty: false,
            cursor: 0,
            scroll: 0,
          },
        ],
      },
    },
    focused: 'p1',
    panel: null,
  }
}

beforeEach(async () => {
  current().reset()
  current().files.set(PAPER, '%PDF paper')
  readOnly.clear()
  readOnly.add(ROOT)

  workspace.spaces = [{ id: 't', name: 'Theirs', root: ROOT }]
  workspace.activeSpaceId = 't'
  workspace.tabs = []
  workspace.activeTabId = null
  workspace.previewTabId = null
  await workspace.loadTree()
  current().sent.length = 0
})

describe('a PDF in a space shared to be read', () => {
  test('a click on its row writes nothing and renames nothing', async () => {
    await workspace.openEntry(PAPER, { preview: true })

    expect(changes()).toEqual([])
    expect([...current().files.keys()]).toEqual([PAPER])
  })

  test('opens as itself, its pages in memory', async () => {
    await workspace.openPdf(PAPER)

    const tab = workspace.tabs.find((one) => one.path === PAPER)
    expect(tab?.kind).toBe('pdf')
    expect(tab?.note.dirty).toBe(false)
    const held = JSON.parse(tab?.note.text ?? '{}') as { nodes?: { file?: string }[] }
    expect(held.nodes?.map((one) => one.file)).toEqual(['paper.pdf', 'paper.pdf'])
  })

  test('does not take in the page note an older build made beside it', async () => {
    current().files.set(NOTE, BESIDE)

    await workspace.openPdf(PAPER)
    await workspace.openPages(NOTE)

    expect(changes()).toEqual([])
    expect(current().files.has(PAPER)).toBe(true)
  })

  test('comes back from an older sitting as itself, and nothing is written', async () => {
    await workspace.applyLayout(sitting())

    expect(changes()).toEqual([])
    expect(workspace.tabs.find((one) => one.path === PAPER)?.kind).toBe('pdf')
  })

  /** A search hit inside the paper a page note holds, or a link to that paper, names
   *  the paper. The note holding it is what the owner drew and wrote on. */
  test('held by a page note, opens that note, read as it is', async () => {
    const held = `${ROOT}/Lecture.pages.pdf`
    const holder = `${ROOT}/Lecture.pages`
    current().files.set(held, '%PDF paper')
    current().files.set(holder, BESIDE.replace('paper.pdf', 'Lecture.pages.pdf'))
    await workspace.loadTree()
    current().sent.length = 0

    await workspace.openPdf(held, 1)

    expect(workspace.tabs.map((one) => `${one.kind} ${one.path}`)).toEqual([`pages ${holder}`])
    expect(changes()).toEqual([])
  })

  test('with an older build’s page note beside it, opens that note, read as it is', async () => {
    current().files.set(NOTE, BESIDE)
    await workspace.loadTree()
    current().sent.length = 0

    await workspace.openPdf(PAPER)

    expect(workspace.tabs.map((one) => `${one.kind} ${one.path}`)).toEqual([`pages ${NOTE}`])
    expect(changes()).toEqual([])
  })

  test('comes back from an older sitting as the page note beside it', async () => {
    current().files.set(NOTE, BESIDE)
    await workspace.loadTree()
    current().sent.length = 0

    await workspace.applyLayout(sitting())

    expect(workspace.tabs.map((one) => `${one.kind} ${one.path}`)).toEqual([`pages ${NOTE}`])
    expect(changes()).toEqual([])
  })

  test('is turned into its page note where the space may be written', async () => {
    readOnly.clear()

    await workspace.openPdf(PAPER)

    expect(current().files.has(NOTE)).toBe(true)
    expect(current().files.has(`${ROOT}/paper.pages.pdf`)).toBe(true)
  })
})
