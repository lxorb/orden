import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'
import { idle } from './settle'

const ROOT = '/space'
const FILES: Record<string, string> = {
  'Plan.md': '# Plan\n',
  'Recipe.url': '[InternetShortcut]\nURL=https://example.com/soup\n',
  'Recipe.webloc':
    '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>URL</key><string>https://example.com/soup</string></dict></plist>\n',
}
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string, args?: { path?: string }) =>
    Promise.resolve(
      command === 'scan_links'
        ? {
            notes: [scanNote('Plan.md', FILES['Plan.md'] ?? '')],
            files: ['Recipe.url', 'Recipe.webloc'],
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
    await idle(25)
    flushSync()
  }
  return target.textContent
}
test('a web link file dropped onto a board is not drawn as its raw shortcut lines', async () => {
  const words = await cardFor('Recipe.url')
  expect(words).not.toContain('[InternetShortcut]')
  expect(words).not.toContain('URL=')
})
test('a webloc dropped onto a board is not drawn as the words of its property list', async () => {
  const words = await cardFor('Recipe.webloc')
  expect(words).not.toContain('URLhttps://example.com/soup')
})
