import { describe, expect, test, vi } from 'vitest'
import { scanNote, scanShortcut } from '@orden/scan/note'

const ROOT = '/space'
const SHORTCUT = '[InternetShortcut]\nURL=https://example.com/soup\n'
const FILES: Record<string, string> = {
  'Today.md': '# Today\n',
  'Recipe.url': SHORTCUT,
}
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string, args?: { path?: string }) =>
    Promise.resolve(
      command === 'scan_links'
        ? {
            notes: [scanNote('Today.md', FILES['Today.md'] ?? ''), scanShortcut('Recipe.url', SHORTCUT)],
            files: ['Recipe.url'],
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
const { readingHtml } = await import('../../src/lib/reading/src/render')
const read = (text: string) => readingHtml({ text, path: `${ROOT}/Today.md` }, 'light', true)
describe('a web link file kept in the space, embedded by its name in the reading view', () => {
  test('named without its extension, which resolves to it, is not drawn as its raw shortcut lines', async () => {
    const html = await read('Soup tonight\n\n![[Recipe]]\n')
    expect(html).not.toContain('InternetShortcut')
    expect(html).not.toContain('URL=')
  })
})
