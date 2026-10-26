import { beforeEach, describe, expect, test, vi } from 'vitest'
import { scanNote } from './scan-note'

/** What renaming or moving a large folder costs the link rewrite, as the space gets
 *  larger.
 *
 *  Counted rather than timed, for the reason the other perf files here give: the
 *  suite runs several files over whatever cores are left, and a rewrite that was
 *  descheduled halfway through says nothing about the rewrite. Two things are
 *  counted, the only two that grow with the space:
 *
 *  - how many files a link to a file is compared with. Every note inside a moved
 *    folder has its own markdown links checked, and a picture link answered by
 *    walking every file in the space, or every file of the same name, is a folder
 *    of a thousand notes times a thousand files. That held the main thread, with
 *    every write held behind it, for seconds.
 *  - how many times the index's notes are put in order by name. A rewrite that told
 *    the index of each note as it went threw that order away per note, and the next
 *    link built it again over the whole space: the folder times the space.
 *
 *  An effect test, so the runes compile for the client and a `$derived` is cached
 *  the way it is in the app; compiled for the server it is worked out again on every
 *  read, and the second count would say nothing.
 *
 *  The shape is what matters, so each count is held against the links rather than a
 *  number: a handful of files per link and one ordering per rewrite. */

const ROOT = '/space'
let notes: Record<string, string> = {}
let files: string[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path.slice(ROOT.length + 1) : ''
    switch (command) {
      case 'scan_links':
        return {
          notes: Object.entries(notes).map(([one, content]) => scanNote(one, content)),
          files,
        }
      case 'read_note':
        return notes[path] ?? null
      case 'write_note':
        notes[path] = typeof args?.content === 'string' ? args.content : ''
        return undefined
      default:
        return undefined
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

beforeEach(() => {
  notes = {}
  files = []
  void startup.shown()
})

/** Renames or moves `from` to `to` in the space as `notes` and `files` hold it, as a
 *  move does: the files go first, and the index still lists them where they were. */
async function moving(from: string, to: string): Promise<number> {
  await links.build(ROOT)
  for (const one of Object.keys(notes)) {
    if (one.startsWith(`${from}/`)) notes[`${to}${one.slice(from.length)}`] = notes[one] ?? ''
  }
  compared = 0
  return links.retarget(`${ROOT}/${from}`, `${ROOT}/${to}`, ROOT, () => null, { moved: true })
}

describe('a large folder renamed or moved', () => {
  test('compares each picture link with a handful of files, not the whole space', async () => {
    let pictures = 0
    for (let one = 0; one < 1000; one++) {
      const own = [0, 1, 2].map((more) => `p${one * 3 + more}.png`)
      notes[`Journal/Day ${one}.md`] = own.map((name) => `![](../assets/${name})`).join('\n')
      files.push(...own.map((name) => `assets/${name}`))
      pictures += own.length
    }

    // Nothing to rewrite: the pictures sit outside the folder at the same depth.
    expect(await moving('Journal', 'Diary')).toBe(0)
    // One candidate per picture link, at most twice; walking the space per link was
    // nine million.
    expect(compared).toBeLessThanOrEqual(2 * pictures)
  })

  test('and where every page has a picture of the same name beside it', async () => {
    // What an export from Notion looks like: a folder per page, each with its own
    // `image.png`.
    let pictures = 0
    for (let one = 0; one < 1000; one++) {
      notes[`Export/Page ${one}/Page ${one}.md`] = '![](image.png) ![](image%201.png)\n'
      files.push(`Export/Page ${one}/image.png`, `Export/Page ${one}/image 1.png`)
      pictures += 2
    }

    expect(await moving('Export', 'Archive/Export')).toBe(0)
    // Every `image.png` in the space per link was two million.
    expect(compared).toBeLessThanOrEqual(2 * pictures)
  })

  test('puts the notes in order by name once, however many it rewrites', async () => {
    const many = 1000
    for (let one = 0; one < many; one++) {
      notes[`Journal/Day ${one}.md`] = `[[Journal/Day ${(one + 1) % many}]]\n`
    }
    for (let one = 0; one < 200; one++) notes[`Topics/Topic ${one}.md`] = `[[Journal/Day ${one}]]\n`

    await links.build(ROOT)
    const before = links.namesBuilt

    expect(await moving('Journal', 'Diary')).toBe(many + 200)
    expect(notes['Diary/Day 0.md']).toBe('[[Diary/Day 1]]\n')
    // Once per rewritten note was twelve hundred.
    expect(links.namesBuilt - before).toBeLessThanOrEqual(2)
  })
})
