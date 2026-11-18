import { describe, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'

const ROOT = '/space'

const NOTES: Record<string, string> = {
  'Projects/Alpha/Alpha.md': '# Alpha\n\n![](cover.jpg)\n',
  'Projects/Beta/Beta.md': '# Beta\n\n![](cover.jpg)\n',
}

const FILES = ['Projects/Alpha/cover.jpg', 'Projects/Beta/cover.jpg']

vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  invoke: (command: string) =>
    Promise.resolve(
      command === 'scan_links'
        ? {
            notes: Object.entries(NOTES).map(([path, content]) => scanNote(path, content)),
            files: FILES,
          }
        : undefined,
    ),
}))

const { links, notePicture } = await import('./link-index/src/api')
const { startup } = await import('./launch/src/api')
const { renderOptions } = await import('./export/src/context')

void startup.shown()
await links.build(ROOT)

describe('two folders that each keep a cover.jpg beside their note', () => {
  test('the reading view shows the cover beside the note, not the other folder one', () => {
    const beta = `${ROOT}/Projects/Beta/Beta.md`
    expect(notePicture('cover.jpg', beta, '')).toContain('Projects/Beta/cover.jpg')
  })

  test('the export carries the cover beside the note', async () => {
    const options = await renderOptions({
      source: NOTES['Projects/Beta/Beta.md'] ?? '',
      name: 'Beta.md',
      path: `${ROOT}/Projects/Beta/Beta.md`,
      trusted: true,
    })
    expect(options.resolveImage?.('cover.jpg')).toBe(`${ROOT}/Projects/Beta/cover.jpg`)
  })
})
