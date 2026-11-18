import { describe, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'
import { createEditor, type EditorView, noteIndexEffect } from '@orden/editor'

const ROOT = '/space'
const PATH = `${ROOT}/Trip.md`
const WIKI = '# Trip\n\n![[beach.png]]\n\nWords after.\n'
const SHORT = '# Trip\n\n![](dune.png)\n\nWords after.\n'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string) =>
    Promise.resolve(
      command === 'scan_links'
        ? {
            notes: [scanNote('Trip.md', WIKI)],
            files: ['Trip.md', 'attachments/beach.png', 'attachments/dune.png'],
          }
        : undefined,
    ),
}))

const { links, notePicture } = await import('../../src/lib/link-index/src/api')
const { startup } = await import('../../src/lib/launch/src/api')

const frames = () =>
  new Promise<void>((go) => requestAnimationFrame(() => requestAnimationFrame(() => go())))

function opened(doc: string): { view: EditorView; parent: HTMLElement } {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createEditor({
    parent,
    doc,
    resolveImage: (src) => notePicture(src, PATH, doc),
    notes: links.index(PATH),
  })
  return { view, parent }
}

function pictures(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll('img')]
    .map((one) => one.getAttribute('src') ?? '')
    .filter((src) => src.includes('.png'))
}

const building = links.build(ROOT)
const wiki = opened(WIKI)
const short = opened(SHORT)
await frames()

void startup.shown()
await building
for (const { view } of [wiki, short]) view.dispatch({ effects: noteIndexEffect(links.index(PATH)) })
await frames()

describe('a note open at launch, drawn before the link index has landed', () => {
  test('a ![[picture]] kept in the attachments folder loads from there once the index lands', () => {
    expect(pictures(wiki.parent)).toEqual(['/asset/space/attachments/beach.png'])
  })

  test('a ![](picture) named by its bare name loads from the attachments folder once the index lands', () => {
    expect(pictures(short.parent)).toEqual(['/asset/space/attachments/dune.png'])
  })

  test('the same note drawn after the index lands finds both pictures', async () => {
    const again = opened(WIKI)
    const other = opened(SHORT)
    await frames()
    expect([...pictures(again.parent), ...pictures(other.parent)]).toEqual([
      '/asset/space/attachments/beach.png',
      '/asset/space/attachments/dune.png',
    ])
  })
})
