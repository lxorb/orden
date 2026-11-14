import '../../sync-ports'
import { describe, expect, test, vi } from 'vitest'

const notes = new Map([['/s/Plan.md', '# Plan\n']])
const renames: Record<string, unknown>[] = []
const trashed: Record<string, unknown>[] = []
const saved: unknown[][] = []

vi.mock('../../platform/src/tauri', () => ({
  isNative: false,
  isDesktop: false,
  platform: () => 'web',
  joinPath: (dir: string, name: string) => `${dir}/${name}`,
  invoke: (command: string, args?: { path?: string; from?: string; to?: string }) => {
    const path = args?.path ?? ''
    if (command === 'create_folder') return Promise.resolve()
    if (command === 'write_note') {
      notes.set(path, (args as { content: string }).content)
      return Promise.resolve()
    }
    if (command === 'rename_note') {
      renames.push({ ...args })
      const holder = args?.to?.replace(/\.pdf$/i, '')
      const held = (args as { hold?: boolean }).hold === true
      if (args?.to?.endsWith('.pages.pdf') && holder && notes.has(holder) && !held)
        return Promise.reject(new Error(`${holder} is already there`))
      const { from = '', to = '' } = args ?? {}
      if (notes.has(from)) notes.set(to, notes.get(from)!)
      notes.delete(from)
      const alone = (args as { alone?: boolean }).alone === true
      if (from.endsWith('.pages') && notes.has(`${from}.pdf`)) {
        notes.set(`${to}.pdf`, notes.get(`${from}.pdf`)!)
        notes.delete(`${from}.pdf`)
      }
      if (from.endsWith('.pdf') && !alone) {
        const sidecar = notes.get(`${from}.highlights.json`)
        notes.delete(`${from}.highlights.json`)
        if (sidecar === undefined) notes.delete(`${to}.highlights.json`)
        else notes.set(`${to}.highlights.json`, sidecar)
      }
      return Promise.resolve()
    }
    if (command === 'trash_item') {
      trashed.push({ ...args })
      notes.delete(path)
      if (path.endsWith('.pdf') && (args as { alone?: boolean }).alone !== true)
        notes.delete(`${path}.highlights.json`)
      return Promise.resolve({})
    }
    if (command === 'file_stamp') return Promise.resolve(null)
    if (command === 'path_exists') return Promise.resolve(notes.has(path))
    if (command === 'read_note' && notes.has(path)) return Promise.resolve(notes.get(path))
    return Promise.reject(new Error(`nothing at ${path}`))
  },
}))
vi.mock('../../accounts/src/client', () => ({ api: {}, BASE: '' }))
vi.mock('../../link-index.svelte', () => ({
  links: { noteSaved: (...said: unknown[]) => saved.push(said) },
}))
vi.mock('../../space-watch', () => ({ scanSpace: () => Promise.resolve([]) }))

const { appWorld } = await import('./app-world')

describe("the browser's disk, as the v2 engine sees it", () => {
  const telling = {} as Parameters<typeof appWorld>[1]

  test('says a listing it could not read, rather than an empty folder', async () => {
    const world = appWorld(() => null, telling)

    expect(await world.list?.('/s')).toBeNull()
  })

  test('has a note that is there, and not one that is not', async () => {
    const { disk } = appWorld(() => null, telling)

    expect(await disk.exists('/s/Plan.md')).toBe(true)
    expect(await disk.exists('/s/Gone.md')).toBe(false)
  })
})

describe('a note another device wrote', () => {
  test('is told to the app as heard, so no device but the one that wrote it dates its todos', async () => {
    const telling = { written: () => undefined } as unknown as Parameters<typeof appWorld>[1]

    await appWorld(() => null, telling).disk.write('/s/Errands.md', '- [x] Post the letter\n')

    expect(notes.get('/s/Errands.md')).toBe('- [x] Post the letter\n')
    expect(saved).toEqual([['/s/Errands.md', '- [x] Post the letter\n', true]])
  })
})

describe('a move the engine makes', () => {
  test('is refused, the file left alone, under a write that has stalled', async () => {
    notes.set('/s/Stuck.md', '# Stuck\n')
    const told: string[] = []
    const telling = {
      holdingWrites: (_from: string, _run: unknown, stalled: () => Promise<void>) => stalled(),
      moved: () => {
        told.push('told')
        return Promise.resolve()
      },
    } as unknown as Parameters<typeof appWorld>[1]

    await expect(
      appWorld(() => null, telling).disk.move('/s/Stuck.md', '/s/Moved too.md', 'file'),
    ).rejects.toThrow('/s/Stuck.md')

    expect(notes.has('/s/Stuck.md')).toBe(true)
    expect(notes.has('/s/Moved too.md')).toBe(false)
    expect(told).toEqual([])
  })

  test('waits for the writes of what it moves, its telling included', async () => {
    notes.set('/s/Held.md', '# Held\n')
    const order: string[] = []
    const telling = {
      holdingWrites: async (from: string, run: () => Promise<void>) => {
        order.push(`held ${from}, ${String(notes.has(from))}`)
        await run()
        order.push('let go')
      },
      moved: () => {
        order.push('told')
        return Promise.resolve()
      },
    } as unknown as Parameters<typeof appWorld>[1]

    await appWorld(() => null, telling).disk.move('/s/Held.md', '/s/Moved.md', 'file')

    expect(order).toEqual(['held /s/Held.md, true', 'told', 'let go'])
    expect(notes.has('/s/Moved.md')).toBe(true)
  })
})

describe('a PDF another device turned into its page note', () => {
  test('moves to the paper of the page note beside it', async () => {
    notes.set('/s/X.pages', '{}')
    const telling = {
      holdingWrites: (_from: string, run: () => Promise<void>) => run(),
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.move('/s/X.pdf', '/s/X.pages.pdf', 'file')

    expect(renames.at(-1)).toEqual({
      arrived: true,
      from: '/s/X.pdf',
      to: '/s/X.pages.pdf',
      alone: true,
      hold: true,
      raw: true,
    })
  })

  test('holds nothing for any other move', async () => {
    const telling = {
      holdingWrites: (_from: string, run: () => Promise<void>) => run(),
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.move('/s/Plan.md', '/s/Done.md', 'file')

    expect(renames.at(-1)).toEqual({
      from: '/s/Plan.md',
      to: '/s/Done.md',
      alone: true,
      arrived: true,
      raw: true,
    })
  })
})

describe('a PDF another device renamed, with its highlights', () => {
  test('keeps the highlights that arrived ahead of the PDF', async () => {
    notes.set('/s/A.pdf', '%PDF')
    notes.set('/s/A.pdf.highlights.json', '{"version":1}')
    const telling = {
      holdingWrites: (_from: string, run: () => Promise<void>) => run(),
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.move('/s/A.pdf.highlights.json', '/s/B.pdf.highlights.json', 'file')
    await disk.move('/s/A.pdf', '/s/B.pdf', 'file')

    expect(notes.get('/s/B.pdf.highlights.json')).toBe('{"version":1}')
    expect(renames.at(-1)).toEqual({
      from: '/s/A.pdf',
      to: '/s/B.pdf',
      alone: true,
      arrived: true,
      raw: true,
    })
  })
})

describe('a page note another device renamed', () => {
  test('moves the note and its paper', async () => {
    notes.set('/s/X.pages', '{}')
    notes.set('/s/X.pages.pdf', '%PDF')
    const telling = {
      holdingWrites: (_from: string, run: () => Promise<void>) => run(),
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.move('/s/X.pages', '/s/Y.pages', 'file')

    expect(notes.has('/s/Y.pages')).toBe(true)
    expect(notes.get('/s/Y.pages.pdf')).toBe('%PDF')
    expect(notes.has('/s/X.pages.pdf')).toBe(false)
  })
})

describe('a highlighted PDF another device turned into its page note', () => {
  test('keeps the highlights', async () => {
    notes.set('/s/T.pdf', '%PDF')
    notes.set('/s/T.pdf.highlights.json', '{"version":1}')
    const telling = {
      holdingWrites: (_from: string, run: () => Promise<void>) => run(),
      moved: () => Promise.resolve(),
      gone: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.remove('/s/T.pdf', 'file')
    await disk.move('/s/T.pdf.highlights.json', '/s/T.pages.pdf.highlights.json', 'file')

    expect(trashed.at(-1)).toEqual({ path: '/s/T.pdf', kind: 'note', alone: true })
    expect(notes.get('/s/T.pages.pdf.highlights.json')).toBe('{"version":1}')
  })
})
