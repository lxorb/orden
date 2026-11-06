import { describe, expect, test } from 'vitest'
import {
  leads,
  openWebNote,
  webNoteCandidates,
  webNotesFor,
  webNotesOf,
  type Opening,
  type WebNote,
} from './web-notes'

const ROOT = '/space'

function sites(entries: Record<string, string | null>) {
  return new Map(Object.entries(entries).map(([path, address]) => [path, { address }]))
}

const SPACE = sites({
  'Code/GitHub issues.url': 'https://github.com/lxorb/orden/issues',
  'Uni/Moodle.url': 'https://moodle-app2.let.ethz.ch/my/',
  'Reading/Svelte docs.url': 'https://svelte.dev/docs/kit',
  'Blank.url': null,
})

const none = () => 0
const titles = (notes: readonly WebNote[]) => notes.map((one) => one.title)

describe('the candidates', () => {
  test('are every website with an address, by its name, its path and where it points', () => {
    const built = webNoteCandidates(SPACE, ROOT, none)
    expect(built.map((one) => one.item)).toEqual([
      {
        path: '/space/Code/GitHub issues.url',
        title: 'GitHub issues',
        url: 'https://github.com/lxorb/orden/issues',
        shown: 'github.com/lxorb/orden/issues',
      },
      {
        path: '/space/Uni/Moodle.url',
        title: 'Moodle',
        url: 'https://moodle-app2.let.ethz.ch/my/',
        shown: 'moodle-app2.let.ethz.ch/my/',
      },
      {
        path: '/space/Reading/Svelte docs.url',
        title: 'Svelte docs',
        url: 'https://svelte.dev/docs/kit',
        shown: 'svelte.dev/docs/kit',
      },
    ])
  })

  test('are built once for each map the index holds, and again for a new one', () => {
    const first = webNotesOf(SPACE, ROOT, none)
    expect(webNotesOf(SPACE, ROOT, none)).toBe(first)
    expect(webNotesOf(new Map(SPACE), ROOT, none)).not.toBe(first)
    expect(webNotesOf(SPACE, '/other', none)).not.toBe(first)
  })
})

describe('what is offered for what was typed', () => {
  const candidates = webNoteCandidates(SPACE, ROOT, none)
  const found = (typed: string) => titles(webNotesFor(typed, candidates))

  test('a name by its start, or by letters spread through it', () => {
    expect(found('moo')[0]).toBe('Moodle')
    expect(found('ghub')[0]).toBe('GitHub issues')
  })

  test('the words in any order', () => {
    expect(found('docs svelte')[0]).toBe('Svelte docs')
  })

  test('the address: its site and its path', () => {
    expect(found('ethz')).toContain('Moodle')
    expect(found('lxorb orden')[0]).toBe('GitHub issues')
  })

  test('a word one slip away', () => {
    expect(found('moodel')[0]).toBe('Moodle')
  })

  test('nothing for nothing typed', () => {
    expect(found('  ')).toEqual([])
  })

  test('the one used most first, of two found as well', () => {
    const two = sites({
      'Docs A.url': 'https://a.example/docs',
      'Docs B.url': 'https://b.example/docs',
    })
    const used = webNoteCandidates(two, ROOT, (key) => (key === 'note:/space/Docs B.url' ? 5 : 0))
    expect(titles(webNotesFor('docs', used))[0]).toBe('Docs B')
  })
})

describe('which stand above the history', () => {
  const [github] = webNoteCandidates(SPACE, ROOT, none).map((one) => one.item)
  if (!github) throw new Error('no note')

  test('a name or a site the typing is the start of', () => {
    expect(leads(github, 'git', false)).toBe(true)
    expect(leads(github, 'github.c', false)).toBe(true)
  })

  test('and one used, however it was found', () => {
    expect(leads(github, 'gtis', false)).toBe(false)
    expect(leads(github, 'gtis', true)).toBe(true)
  })
})

describe('choosing one', () => {
  function store(tabs: { id: string; path: string | null }[], fresh: string[]) {
    const asked: string[] = []
    const ws: Opening = {
      tabs,
      activate: (id) => asked.push(`activate ${id}`),
      close: (id) => asked.push(`close ${id}`),
      isNewTab: (tab) => fresh.includes(tab.id),
      chosenOn: (id) => asked.push(`chosen on ${id}`),
      openEntry: (path) => {
        asked.push(`open ${path}`)
        return Promise.resolve()
      },
    }
    return { ws, asked }
  }

  test('from a new tab, opens it in that tab', async () => {
    const { ws, asked } = store([{ id: 'new', path: null }], ['new'])
    await openWebNote(ws, { id: 'new' }, '/space/Uni/Moodle.url')
    expect(asked).toEqual(['chosen on new', 'open /space/Uni/Moodle.url'])
  })

  test('switches to it where it is open, and the new tab it was chosen in goes', async () => {
    const { ws, asked } = store(
      [
        { id: 'new', path: null },
        { id: 'moodle', path: '/space/Uni/Moodle.url' },
      ],
      ['new'],
    )
    await openWebNote(ws, { id: 'new' }, '/space/Uni/Moodle.url')
    expect(asked).toEqual(['activate moodle', 'close new'])
  })

  test('from a tab on a page, opens it without taking that tab', async () => {
    const { ws, asked } = store([{ id: 'page', path: '/space/Reading/Svelte docs.url' }], [])
    await openWebNote(ws, { id: 'page' }, '/space/Uni/Moodle.url')
    expect(asked).toEqual(['open /space/Uni/Moodle.url'])
  })
})
