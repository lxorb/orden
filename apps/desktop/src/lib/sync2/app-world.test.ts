import { describe, expect, test, vi } from 'vitest'

/** The disk the v2 engine is handed in the browser, which keeps no stamps:
 *  `file_stamp` answers null for every path there (web/commands.ts). Asked by a stamp
 *  alone, every file read as not there, and a note deleted on another device was
 *  never deleted in the browser. */

const notes = new Map([['/s/Plan.md', '# Plan\n']])
const renames: Record<string, unknown>[] = []
const trashed: Record<string, unknown>[] = []

vi.mock('../tauri', () => ({
  isNative: false,
  isDesktop: false,
  platform: () => 'web',
  joinPath: (dir: string, name: string) => `${dir}/${name}`,
  invoke: (command: string, args?: { path?: string; from?: string; to?: string }) => {
    const path = args?.path ?? ''
    if (command === 'create_folder') return Promise.resolve()
    if (command === 'rename_note') {
      // The crate's guard: a PDF going to a page note's paper name is refused unless
      // it is held there on purpose; see `rename_note` in notes.rs.
      renames.push({ ...args })
      const holder = args?.to?.replace(/\.pdf$/i, '')
      const held = (args as { hold?: boolean }).hold === true
      if (args?.to?.endsWith('.pages.pdf') && holder && notes.has(holder) && !held)
        return Promise.reject(new Error(`${holder} is already there`))
      // And `move_held`: a PDF's highlights go with it, and highlights already at the
      // new name are cleared where it has none, unless the move is the file alone.
      const { from = '', to = '' } = args ?? {}
      if (notes.has(from)) notes.set(to, notes.get(from)!)
      notes.delete(from)
      const alone = (args as { alone?: boolean }).alone === true
      // A page note's paper goes with it either way: sync carries it with the note, never
      // as an entry of its own.
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
      // The crate's `trash_item`: a PDF's highlights go with it, unless the delete is
      // sync's, which leaves what the account holds as an entry of its own.
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
vi.mock('../api', () => ({ api: {}, BASE: '' }))
vi.mock('../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))
vi.mock('../space-watch', () => ({ scanSpace: () => Promise.resolve([]) }))

const { appWorld } = await import('./app-world')

describe("the browser's disk, as the v2 engine sees it", () => {
  const telling = {} as Parameters<typeof appWorld>[1]

  test('has a note that is there, and not one that is not', async () => {
    const { disk } = appWorld(() => null, telling)

    expect(await disk.exists('/s/Plan.md')).toBe(true)
    expect(await disk.exists('/s/Gone.md')).toBe(false)
  })
})

describe('a PDF another device turned into its page note', () => {
  // On the other device the PDF beside `X.pages` went to `X.pages.pdf`, the paper
  // that note holds. The move came here without saying so, the crate refused it as a
  // PDF put where a page note takes it for its paper, and every pass stopped there.
  test('moves to the paper of the page note beside it', async () => {
    notes.set('/s/X.pages', '{}')
    const telling = {
      touching: () => undefined,
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.move('/s/X.pdf', '/s/X.pages.pdf', 'file')

    expect(renames.at(-1)).toEqual({
      from: '/s/X.pdf',
      to: '/s/X.pages.pdf',
      alone: true,
      hold: true,
    })
  })

  test('holds nothing for any other move', async () => {
    const telling = {
      touching: () => undefined,
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.move('/s/Plan.md', '/s/Done.md', 'file')

    expect(renames.at(-1)).toEqual({ from: '/s/Plan.md', to: '/s/Done.md', alone: true })
  })
})

describe('a PDF another device renamed, with its highlights', () => {
  // The other device moved `A.pdf` to `B.pdf` and its highlights with it, and the
  // account holds the two as moves of their own, which come here in either order.
  // Highlights first, then the PDF: a move that took companions found none at `A.pdf`,
  // cleared the ones that had just arrived at `B.pdf`, and the next scan sent that
  // delete everywhere.
  test('keeps the highlights that arrived ahead of the PDF', async () => {
    notes.set('/s/A.pdf', '%PDF')
    notes.set('/s/A.pdf.highlights.json', '{"version":1}')
    const telling = {
      touching: () => undefined,
      moved: () => Promise.resolve(),
    } as unknown as Parameters<typeof appWorld>[1]
    const { disk } = appWorld(() => null, telling)

    await disk.move('/s/A.pdf.highlights.json', '/s/B.pdf.highlights.json', 'file')
    await disk.move('/s/A.pdf', '/s/B.pdf', 'file')

    expect(notes.get('/s/B.pdf.highlights.json')).toBe('{"version":1}')
    expect(renames.at(-1)).toEqual({ from: '/s/A.pdf', to: '/s/B.pdf', alone: true })
  })
})

describe('a page note another device renamed', () => {
  // The paper is no entry of the account's (#551): it goes with the note. Left behind,
  // it was downloaded again under the new name and the old one listed as a new PDF.
  test('moves the note and its paper', async () => {
    notes.set('/s/X.pages', '{}')
    notes.set('/s/X.pages.pdf', '%PDF')
    const telling = {
      touching: () => undefined,
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
  // There the PDF went to the paper and its highlights with it; here that comes as a
  // delete of the PDF, run first, and a move of its highlights. The delete took the
  // highlights into the trash, the move found nothing, and the next scan sent the
  // highlights' delete everywhere.
  test('keeps the highlights', async () => {
    notes.set('/s/T.pdf', '%PDF')
    notes.set('/s/T.pdf.highlights.json', '{"version":1}')
    const telling = {
      touching: () => undefined,
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
