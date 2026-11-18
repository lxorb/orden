import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'

const ROOT = '/space'

const NOTES: Record<string, string> = {
  'Journal/Day.md': '# Day\n\n![](../assets/3f2a9c.png)\n\n![](pics/sea.png)\n',
}

const FILES = ['assets/3f2a9c.png', 'Journal/pics/sea.png', 'pics/sea.png']

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string, args?: { path?: string }) =>
    Promise.resolve(
      command === 'scan_links'
        ? {
            notes: Object.entries(NOTES).map(([path, content]) => scanNote(path, content)),
            files: FILES,
          }
        : command === 'read_note'
          ? (NOTES[(args?.path ?? '').slice(ROOT.length + 1)] ?? null)
          : undefined,
    ),
}))

const { links } = await import('../../src/lib/link-index/src/api')
const { startup } = await import('../../src/lib/launch/src/api')
void startup.shown()
await links.build(ROOT)

const CanvasNode = (await import('../../src/lib/canvas/src/CanvasNode.svelte')).default

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

let shown: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.replaceChildren()
})

async function cardOnBoard(): Promise<string[]> {
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(CanvasNode, {
    target,
    props: {
      node: { id: 'n1', type: 'file', file: 'Journal/Day.md', x: 0, y: 0, width: 400, height: 400 },
      canvasPath: `${ROOT}/Board.canvas`,
      trusted: true,
      root: ROOT,
      picked: false,
      editing: false,
      offset: { x: 0, y: 0 },
    } as never,
  })
  flushSync()
  for (let round = 0; round < 20 && !target.querySelector('img'); round++) {
    await wait(25)
    flushSync()
  }
  return [...target.querySelectorAll('img')].map((one) => one.getAttribute('src') ?? '')
}

test('a note card on a board shows a picture the note links with ../ as Orden writes it', async () => {
  const sources = await cardOnBoard()
  expect(sources[0]).toContain(`${ROOT}/assets/3f2a9c.png`)
})

test('a note card on a board shows the picture beside the note, not a namesake beside the board', async () => {
  const sources = await cardOnBoard()
  expect(sources[1]).toContain(`${ROOT}/Journal/pics/sea.png`)
})
