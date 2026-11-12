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

const { runExport } = await import('./run')

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

test('a page with its pictures goes out in pieces, each picture written in, never one string', async () => {
  handed.length = 0

  await runExport('html', {
    source: '# Trip\n\n![a](a.png)\n\n![b](b.png)\n',
    name: 'Trip.md',
    path: '/space/Trip.md',
  })

  const payload = handed[0]
  if (!payload || !('pieces' in payload)) throw new Error('the page was not handed over in pieces')
  const page = await payload.pieces.text()
  expect(page).toContain('src="data:image/png;base64,AQ=="')
  expect(page).not.toContain('src="a.png"')
  expect(page).not.toContain('src="b.png"')
})
