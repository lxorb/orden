import { beforeEach, describe, expect, test, vi } from 'vitest'
import { scanNote } from '@orden/scan/note'

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

let compared = 0
vi.mock('@orden/editor', async (importOriginal) => {
  const real = await importOriginal<typeof import('@orden/editor')>()
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

    expect(await moving('Journal', 'Diary')).toBe(0)
    expect(compared).toBeLessThanOrEqual(2 * pictures)
  })

  test('and where every page has a picture of the same name beside it', async () => {
    let pictures = 0
    for (let one = 0; one < 1000; one++) {
      notes[`Export/Page ${one}/Page ${one}.md`] = '![](image.png) ![](image%201.png)\n'
      files.push(`Export/Page ${one}/image.png`, `Export/Page ${one}/image 1.png`)
      pictures += 2
    }

    expect(await moving('Export', 'Archive/Export')).toBe(0)
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
    expect(links.namesBuilt - before).toBeLessThanOrEqual(2)
  })
})
