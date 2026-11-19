import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'
import { idle } from './settle'

const ROOT = '/space'
const NOTES: Record<string, string> = {
  'Plan.md': '# Plan\n\nThe opening words.\n\n## Later\n\nThe later words. ^later\n\n## Last\n\nThe last words.\n',
}
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string, args?: { path?: string }) =>
    Promise.resolve(
      command === 'scan_links'
        ? {
            notes: Object.entries(NOTES).map(([path, content]) => scanNote(path, content)),
            files: [],
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
let shown: ReturnType<typeof mount> | null = null
afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  document.body.replaceChildren()
})
async function cardFor(subpath: string): Promise<string> {
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(CanvasNode, {
    target,
    props: {
      node: {
        id: 'n1',
        type: 'file',
        file: 'Plan.md',
        subpath,
        x: 0,
        y: 0,
        width: 400,
        height: 400,
      },
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
  return target.querySelector('.card')?.textContent ?? ''
}
test('a note card naming a heading shows that section of the note, not the whole note', async () => {
  const words = await cardFor('#Later')
  expect(words).toContain('The later words.')
  expect(words).not.toContain('The opening words.')
  expect(words).not.toContain('The last words.')
})
test('a note card naming a block shows only that block', async () => {
  const words = await cardFor('#^later')
  expect(words).toContain('The later words.')
  expect(words).not.toContain('The opening words.')
})
