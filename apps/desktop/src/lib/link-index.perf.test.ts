import { describe, expect, test, vi } from 'vitest'
import { scanNote } from './scan-note'

/** What renaming a large folder costs the link rewrite, as the space gets larger.
 *
 *  Counted rather than timed, for the reason the other perf files here give: the
 *  suite runs several files over whatever cores are left, and a rewrite that was
 *  descheduled halfway through says nothing about the rewrite. What is counted is how
 *  many files a link to a file is compared with, which is the only thing that grows
 *  with the space: every note inside a moved folder has its own markdown links
 *  checked, and a picture link answered by walking every file in the space is a
 *  folder of a thousand journal notes times three thousand pictures, twice over.
 *  That held the main thread, with every write held behind it, for seven seconds.
 *
 *  The shape is what matters, so the count is held against the links rather than a
 *  number: a handful of files per link, where walking the space per link is the
 *  links times the files. */

const ROOT = '/space'
const notes: Record<string, string> = {}
const files: string[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string) => {
    if (command !== 'scan_links') return undefined
    return {
      notes: Object.entries(notes).map(([one, content]) => scanNote(one, content)),
      files,
    }
  },
}))

/** Every file a link to a file was compared with. */
let compared = 0
vi.mock('@nib/editor', async (importOriginal) => {
  const real = await importOriginal<typeof import('@nib/editor')>()
  return {
    ...real,
    resolveFile: (...args: Parameters<typeof real.resolveFile>) => {
      compared += args[0].files.length
      return real.resolveFile(...args)
    },
  }
})

const { links } = await import('./link-index.svelte')
const { startup } = await import('./startup.svelte')

describe('a large folder renamed', () => {
  test('compares each picture link with a handful of files, not the whole space', async () => {
    const many = 1000
    let pictures = 0
    for (let one = 0; one < many; one++) {
      const own = [0, 1, 2].map((more) => `p${one * 3 + more}.png`)
      notes[`Journal/Day ${one}.md`] = own.map((name) => `![](../assets/${name})`).join('\n')
      files.push(...own.map((name) => `assets/${name}`))
      pictures += own.length
    }

    void startup.shown()
    await links.build(ROOT)
    compared = 0

    const touched = await links.retarget(`${ROOT}/Journal`, `${ROOT}/Diary`, ROOT, () => null, {
      moved: true,
    })

    // Nothing to rewrite: the pictures sit outside the folder at the same depth.
    expect(touched).toBe(0)
    // One candidate per picture link, at most twice; walking the space per link was
    // eighteen million.
    expect(compared).toBeLessThanOrEqual(2 * pictures)
  })
})
