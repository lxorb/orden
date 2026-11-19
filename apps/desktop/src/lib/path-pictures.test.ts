import { describe, expect, test, vi } from 'vitest'
import { renderMarkdown } from '@orden/markdown'
import { noteLinks } from '@orden/editor/note-links'
import { scanNote } from '@orden/scan/note'

const ROOT = '/space'

const NOTES: Record<string, string> = {
  'Journal/Day.md': '# Day\n\n![[trips/cat.png]]\n',
}

const FILES = ['trips/cat.png', 'home/cat.png']

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
const { withPictures } = await import('./reading/src/render')

void startup.shown()
await links.build(ROOT)

const DAY = `${ROOT}/Journal/Day.md`

describe('a picture embedded by its path in the space, from a note in a folder', () => {
  test('Orden itself writes the space path when two pictures share a name', () => {
    const index = {
      notes: [],
      files: FILES,
      path: 'Journal/Day.md',
      read: () => Promise.resolve(null),
    }
    expect(noteLinks(index, ['trips/cat.png'], (target) => `[[${target.name}]]`)).toBe('![[trips/cat.png]]')
  })

  test('the reading view shows the picture at that path in the space', () => {
    const html = withPictures(renderMarkdown('![[trips/cat.png]]'), {
      path: DAY,
      text: NOTES['Journal/Day.md'] ?? '',
    })
    expect(html).toContain(`${ROOT}/trips/cat.png`)
    expect(html).not.toContain('Journal/trips')
  })

  test('the editor shows the picture at that path in the space', () => {
    expect(notePicture('trips/cat.png', DAY, '')).toContain(`${ROOT}/trips/cat.png`)
  })

  test('the export carries the picture at that path in the space', async () => {
    const options = await renderOptions({
      source: NOTES['Journal/Day.md'] ?? '',
      name: 'Day.md',
      path: DAY,
      trusted: true,
    })
    expect(options.resolveImage?.('trips/cat.png')).toBe(`${ROOT}/trips/cat.png`)
  })
})
