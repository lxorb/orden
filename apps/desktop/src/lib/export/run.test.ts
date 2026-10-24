/** What an export hands the writer, for the formats whose files land beside the
 *  one the save dialog was given. Where they land is measured in save.test.ts;
 *  this is the half that has to know what is inside them. */

import { expect, test, vi } from 'vitest'
import type { Payload } from './save'

/** What the writer was handed. */
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
