import { describe, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'
import { createEditor, noteIndexEffect } from '@orden/editor'

const ROOT = '/space'
const PATH = `${ROOT}/Trip.md`
const PICTURES = Array.from({ length: 12 }, (_, at) => `![](pic${at}.png)\n`).join('\n')
const DOC = `# Trip\n\n${PICTURES}\nWords after.\n`
const NOTES = Array.from({ length: 8000 }, (_, at) => `folder${at % 50}/Note ${at}.md`)
const KEPT = Array.from({ length: 12 }, (_, at) => `attachments/pic${at}.png`)

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  invoke: (command: string) =>
    Promise.resolve(
      command === 'scan_links'
        ? { notes: [scanNote('Trip.md', DOC)], files: ['Trip.md', ...NOTES, ...KEPT] }
        : undefined,
    ),
}))

const { links, notePicture } = await import('../../src/lib/link-index/src/api')
const { startup } = await import('../../src/lib/launch/src/api')

const building = links.build(ROOT)
void startup.shown()
await building

function typingCost(resolve: (src: string) => string): number {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = createEditor({ parent, doc: DOC, resolveImage: resolve, notes: links.index(PATH) })
  view.dispatch({ effects: noteIndexEffect(links.index(PATH)) })
  view.dispatch({ selection: { anchor: view.state.doc.length - 1 } })

  const start = performance.now()
  for (let typed = 0; typed < 40; typed++) {
    const at = view.state.selection.main.head
    view.dispatch({ changes: { from: at, insert: 'x' }, selection: { anchor: at + 1 } })
  }
  const spent = performance.now() - start
  view.destroy()
  parent.remove()
  return spent
}

describe('typing in a note with pictures, in a space of many files', () => {
  test('costs about what it costs when picture addresses are free to work out', () => {
    const plain = typingCost((src) => src)
    const real = typingCost((src) => notePicture(src, PATH, DOC))
    expect(real).toBeLessThan(plain * 4 + 200)
  }, 60000)
})
