import { expect, test, vi } from 'vitest'
import type { Payload } from './save'

const handed: Payload[] = []

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  isNative: true,
  isMobile: false,
  isDesktop: true,
}))

vi.mock('./save', () => ({
  chooseTarget: () => Promise.resolve(null),
  deliver: (_name: string, _extension: string, _label: string, payload: Payload) => {
    handed.push(payload)
    return Promise.resolve('/out/Trip.md')
  },
}))

vi.mock('./pictures', async (original) => ({
  ...(await original<typeof import('./pictures')>()),
  readPictures: (sources: readonly string[]) =>
    Promise.resolve(
      sources.map((src) => ({
        src,
        name: 'image.png',
        mime: 'image/png',
        bytes: new Uint8Array([1]),
      })),
    ),
}))

const listed = vi.hoisted(() => new Set<string>())
vi.mock('../rows/todo-lists', () => ({ isListed: (path: string) => listed.has(path) }))

const { runExport } = await import('./run')
const { workspace } = await import('../workspace.svelte')

test('markdown with pictures links a picture under the name it landed at', async () => {
  await runExport('md-assets', {
    source: '# Trip\n\n![](image.png)\n',
    name: 'Trip.md',
    path: '/space/Trip.md',
  })

  const payload = handed[0]
  if (!payload || !('files' in payload)) throw new Error('no files were handed over')
  expect(payload.files[0]?.body).toContain('](assets/image.png)')

  const text = payload.relink?.(new Map([['assets/image.png', 'assets/image 2.png']]))
  expect(text).toContain('](<assets/image 2.png>)')
  expect(text).not.toContain('](assets/image.png)')
})

test("a todo list carries its mark and its todos' done dates out (#1229)", async () => {
  const { datesText, DONE_KEY } = await import('@orden/bases/todo-lists')
  const { taskHash } = await import('@orden/bases')
  listed.add('/space/Errands.md')
  vi.spyOn(workspace.itemMeta, 'of').mockReturnValue({
    'todo-list': 'yes',
    [DONE_KEY]: datesText(new Map([[taskHash('Post it'), '2026-11-01']])) ?? '',
  })
  handed.length = 0

  await runExport('md', {
    source: '- [x] Post it\n',
    name: 'Errands.md',
    path: '/space/Errands.md',
  })

  const payload = handed[0]
  if (!payload || !('text' in payload)) throw new Error('no text was handed over')
  expect(payload.text).toBe('---\ntodo-list: yes\n---\n- [x] Post it ✅ 2026-11-01\n')
})
