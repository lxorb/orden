import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'

const ROOT = '/space'

const FILES: Record<string, string> = {
  'Plan.md': '# Plan\n',
  'Trip.canvas':
    '{"nodes":[{"id":"a","type":"text","text":"inner words","x":0,"y":0,"width":10,"height":10}],"edges":[]}',
  'Books.base': 'views:\n  - type: table\n    name: All\n',
}

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string, args?: { path?: string }) =>
    Promise.resolve(
      command === 'scan_links'
        ? {
            notes: [scanNote('Plan.md', FILES['Plan.md'] ?? '')],
            files: ['Trip.canvas', 'Books.base'],
          }
        : command === 'read_note'
          ? (FILES[(args?.path ?? '').slice(ROOT.length + 1)] ?? null)
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

async function cardFor(file: string): Promise<string> {
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(CanvasNode, {
    target,
    props: {
      node: { id: 'n1', type: 'file', file, x: 0, y: 0, width: 400, height: 400 },
      canvasPath: `${ROOT}/Board.canvas`,
      trusted: true,
      root: ROOT,
      picked: false,
      editing: false,
      offset: { x: 0, y: 0 },
    } as never,
  })
  flushSync()
  for (let round = 0; round < 20 && !target.querySelector('.card'); round++) {
    await wait(25)
    flushSync()
  }
  return target.textContent
}

test('a board dropped onto a board is not drawn as its raw JSON', async () => {
  const words = await cardFor('Trip.canvas')
  expect(words).not.toContain('"nodes"')
  expect(words).not.toContain('"edges"')
})

test('a base dropped onto a board is not drawn as its raw YAML', async () => {
  const words = await cardFor('Books.base')
  expect(words).not.toContain('views:')
})
