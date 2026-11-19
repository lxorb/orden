import { describe, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'

const ROOT = '/space'
const PATH = `${ROOT}/Trip.md`
const DOC = '# Trip\n\n![[photo.png]]\n\n![[photo.png|300]]\n'
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string) =>
    Promise.resolve(
      command === 'scan_links'
        ? { notes: [scanNote('Trip.md', DOC)], files: ['Trip.md', 'attachments/photo.png'] }
        : undefined,
    ),
}))
const { links } = await import('../../src/lib/link-index/src/api')
const { startup } = await import('../../src/lib/launch/src/api')
const { toMarkdown } = await import('../../src/lib/export/src/markdown')
const building = links.build(ROOT)
void startup.shown()
await building
const exported = () => toMarkdown(DOC, { link: (link) => links.relativeTarget(link, PATH) })
describe('a note with ![[picture]] embeds, exported as plain Markdown', () => {
  test('still shows the picture, not its file name as words', () => {
    expect(exported()).toContain('![](attachments/photo.png)')
  })
  test('does not turn a sized embed into the bare number', () => {
    expect(exported().split('\n')).not.toContain('300')
  })
})
