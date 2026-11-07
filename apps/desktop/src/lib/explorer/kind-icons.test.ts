import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

const askedOf: string[] = []

vi.mock('../tauri', async (original) => ({
  ...(await original<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: (command: string, args: { ending: string }) => {
    if (command === 'explorer_icon') askedOf.push(args.ending)
    return Promise.resolve(`data:image/png;base64,${args.ending}`)
  },
}))

const { KindIcons, kindOf } = await import('./kind-icons')
const EntryMark = (await import('./EntryMark.svelte')).default
const { workspace } = await import('../workspace.svelte')

const settled = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

function held() {
  const asked: string[] = []
  const waiting = new Map<string, (url: string | null) => void>()
  const icons = new KindIcons(
    (ending) =>
      new Promise((done) => {
        asked.push(ending)
        waiting.set(ending, done)
      }),
  )
  const answer = async (ending: string, url: string | null) => {
    waiting.get(ending)?.(url)
    waiting.delete(ending)
    await settled()
  }
  return { icons, asked, answer }
}

describe("a file's kind", () => {
  test('is its lowercased ending, and nothing when the ending is no kind', () => {
    expect(kindOf('Report.DOCX')).toBe('docx')
    expect(kindOf('archive.tar.gz')).toBe('gz')
    expect(kindOf('Makefile')).toBe('')
    expect(kindOf('.bashrc')).toBe('')
    expect(kindOf('notes from 3.5 hours of talk')).toBe('')
  })
})

describe("the system's icons for kinds of file", () => {
  test('are asked for once a kind, however many files of it are drawn', async () => {
    const { icons, asked, answer } = held()
    for (let one = 0; one < 50; one++) expect(icons.of(`${one}.docx`)).toBeNull()
    await settled()
    expect(asked).toEqual(['docx'])
    await answer('docx', 'data:image/png;base64,AA')
    expect(icons.of('other.DOCX')).toBe('data:image/png;base64,AA')
    expect(asked).toEqual(['docx'])
  })

  test('a few are asked for at once, the rest when those come back', async () => {
    const { icons, asked, answer } = held()
    for (let one = 0; one < 20; one++) icons.of(`a.k${one}`)
    await settled()
    expect(asked).toHaveLength(4)
    await answer('k0', null)
    expect(asked).toHaveLength(5)
  })

  test('a kind the system has no icon for is not asked for again', async () => {
    const { icons, asked, answer } = held()
    icons.of('a.zzz')
    await settled()
    await answer('zzz', null)
    expect(icons.of('b.zzz')).toBeNull()
    await settled()
    expect(asked).toEqual(['zzz'])
  })

  test('nothing is asked where there is no system to ask', async () => {
    const icons = new KindIcons(null)
    expect(icons.of('a.docx')).toBeNull()
    await settled()
  })
})

describe('a row of the file explorer', () => {
  test("wears Orden's own mark for what Orden opens and asks the system only for the rest", async () => {
    workspace.spaces = [{ id: 's', name: 'Me', root: '/me' }]
    const drawn = (path: string, folder = false) =>
      render(EntryMark, { props: { path, folder } }).body
    for (const name of ['Plan.md', 'notes.txt', 'paper.pdf', 'board.canvas', 'book.pages']) {
      expect(drawn(`/me/${name}`)).toContain('<svg')
    }
    drawn('/me/Folder.docx', true)
    await settled()
    expect(askedOf).toEqual([])

    expect(drawn('/me/Budget.xlsx')).toContain('<svg')
    drawn('/me/photo.png')
    drawn('/elsewhere/Plan.md')
    await settled()
    expect(askedOf).toEqual(['xlsx', 'png', 'md'])
    expect(drawn('/me/Q3.xlsx')).toContain('<img src="data:image/png;base64,xlsx"')
  })
})
