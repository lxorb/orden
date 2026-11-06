import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const pushed: string[] = []
vi.mock('../sync.svelte', () => ({
  sync: {
    pushBookmarks: (root: string) => {
      pushed.push(root)
      return Promise.resolve()
    },
  },
}))

const {
  BOOKMARK_KINDS,
  Bookmarks,
  bookmarkList,
  isBookmark,
  located,
  mergeBookmarks,
  MOST_BOOKMARKS,
  sameBookmark,
} = await import('./bookmarks.svelte')
const { sayEntryIds } = await import('./entry-ids')

type Bookmark = import('./bookmarks.svelte').Bookmark

const note = (path: string): Bookmark => ({ kind: 'note', path, text: '' })
const folder = (path: string): Bookmark => ({ kind: 'folder', path, text: '' })
const heading = (path: string, text: string): Bookmark => ({ kind: 'heading', path, text })
const search = (text: string): Bookmark => ({ kind: 'search', path: '', text })

function store(root: string | null = '/Notes') {
  return new Bookmarks(() => root)
}

beforeEach(() => {
  localStorage.clear()
  pushed.length = 0
})

describe('what counts as a bookmark', () => {
  test('is one of the four kinds, with a path and a text', () => {
    for (const kind of BOOKMARK_KINDS) {
      expect(isBookmark({ kind, path: 'a.md', text: '' }), kind).toBe(true)
    }

    expect(isBookmark({ kind: 'tag', path: 'a.md', text: '' })).toBe(false)
    expect(isBookmark({ kind: 'note', path: 'a.md' })).toBe(false)
    expect(isBookmark({ kind: 'note', text: '' })).toBe(false)
    expect(isBookmark(null)).toBe(false)
    expect(isBookmark(['note'])).toBe(false)
  })

  test('is read out of a stored list one entry at a time', () => {
    const read = bookmarkList([note('a.md'), { kind: 'tag', path: '', text: 'x' }, 7, null])
    expect(read).toEqual([note('a.md')])
  })

  test('is nothing at all when the stored value is not a list', () => {
    expect(bookmarkList('a.md')).toEqual([])
    expect(bookmarkList({ 0: note('a.md') })).toEqual([])
    expect(bookmarkList(undefined)).toEqual([])
  })

  test('keeps only the fields a bookmark has', () => {
    const read = bookmarkList([{ kind: 'note', path: 'a.md', text: '', colour: 'red' }])
    expect(read).toEqual([note('a.md')])
  })

  test('is capped, however long the stored list is', () => {
    const many = Array.from({ length: MOST_BOOKMARKS + 20 }, (_, at) => note(`${at}.md`))
    expect(bookmarkList(many)).toHaveLength(MOST_BOOKMARKS)
  })

  test('is the same one when it points at the same thing', () => {
    expect(sameBookmark(note('a.md'), note('a.md'))).toBe(true)
    expect(sameBookmark(note('a.md'), folder('a.md'))).toBe(false)
    expect(sameBookmark(heading('a.md', 'Why'), heading('a.md', 'How'))).toBe(false)
    expect(sameBookmark(search('tea'), search('tea'))).toBe(true)
  })
})

describe('merging what a machine had into what the account holds', () => {
  test("keeps the account's order and adds what only the machine had", () => {
    const theirs = [note('a.md'), search('tea')]
    const mine = [search('tea'), folder('Work')]

    expect(mergeBookmarks(theirs, mine)).toEqual([note('a.md'), search('tea'), folder('Work')])
  })

  test('adds nothing twice', () => {
    const both = [note('a.md'), heading('b.md', 'Why')]
    expect(mergeBookmarks(both, both)).toEqual(both)
  })

  test('is capped like every other list', () => {
    const theirs = Array.from({ length: MOST_BOOKMARKS }, (_, at) => note(`t${at}.md`))
    const mine = [note('mine.md')]

    const merged = mergeBookmarks(theirs, mine)
    expect(merged).toHaveLength(MOST_BOOKMARKS)
    expect(merged).not.toContainEqual(note('mine.md'))
  })
})

describe('bookmarking', () => {
  test('turns the thing in and out again with the one call', () => {
    const marks = store()

    marks.toggle(note('a.md'))
    expect(marks.list).toEqual([note('a.md')])
    expect(marks.has(note('a.md'))).toBe(true)

    marks.toggle(note('a.md'))
    expect(marks.list).toEqual([])
    expect(marks.has(note('a.md'))).toBe(false)
  })

  test('takes a selection in with one press, and out again once all of it is in', () => {
    const marks = store()
    marks.toggle(note('a.md'))

    marks.toggleAll([note('a.md'), folder('B')])
    expect(marks.list).toEqual([note('a.md'), folder('B')])

    marks.toggleAll([note('a.md'), folder('B')])
    expect(marks.list).toEqual([])
  })

  test('offers the space to the account on every change', async () => {
    const marks = store()
    marks.toggle(search('tea'))

    await marks.offered

    expect(pushed).toEqual(['/Notes'])
  })

  test('does nothing without a space to keep it in', () => {
    const marks = store(null)
    marks.toggle(note('a.md'))

    expect(marks.list).toEqual([])
    expect(pushed).toEqual([])
  })

  test('keeps one list per space', () => {
    let root = '/Notes'
    const marks = new Bookmarks(() => root)

    marks.toggle(note('a.md'))
    root = '/Other'
    expect(marks.list).toEqual([])

    marks.toggle(search('tea'))
    expect(marks.of('/Notes')).toEqual([note('a.md')])
    expect(marks.of('/Other')).toEqual([search('tea')])
  })

  test('is remembered for the next run', () => {
    store().toggle(heading('a.md', 'Why'))
    expect(store().list).toEqual([heading('a.md', 'Why')])
  })

  test('stops at the cap rather than growing without end', () => {
    const marks = store()
    for (let at = 0; at < MOST_BOOKMARKS + 5; at++) marks.toggle(note(`${at}.md`))

    expect(marks.list).toHaveLength(MOST_BOOKMARKS)
  })
})

describe('what a row stands for', () => {
  test('is a note or a folder, named the way the space names it', () => {
    const marks = store()

    expect(marks.forEntry({ path: '/Notes/Work/Plan.md', is_dir: false })).toEqual(
      note('Work/Plan.md'),
    )
    expect(marks.forEntry({ path: '/Notes/Work', is_dir: true })).toEqual(folder('Work'))
  })

  test('is nothing for a row outside the open space', () => {
    expect(store().forEntry({ path: '/Other/a.md', is_dir: false })).toBeNull()
    expect(store(null).forEntry({ path: '/Notes/a.md', is_dir: false })).toBeNull()
  })

  test('is a heading of the note it was read from', () => {
    expect(store().forHeading('a.md', ' Why it works ')).toEqual(heading('a.md', 'Why it works'))
    expect(store().forHeading(null, 'Why')).toBeNull()
    expect(store().forHeading('a.md', '   ')).toBeNull()
  })

  test('is the words in the search box, once there are any', () => {
    expect(store().forSearch('  tea  ')).toEqual(search('tea'))
    expect(store().forSearch('   ')).toBeNull()
  })
})

describe('dragging a row somewhere else', () => {
  function three() {
    const marks = store()
    marks.toggle(note('a.md'))
    marks.toggle(note('b.md'))
    marks.toggle(note('c.md'))
    return marks
  }

  test('puts it where it was dropped', () => {
    const marks = three()
    marks.move(2, 0)

    expect(marks.list).toEqual([note('c.md'), note('a.md'), note('b.md')])
  })

  test('moves one down as well as up', () => {
    const marks = three()
    marks.move(0, 2)

    expect(marks.list).toEqual([note('b.md'), note('c.md'), note('a.md')])
  })

  test('leaves the order alone when the drop landed on nothing', () => {
    const marks = three()
    marks.move(0, 9)
    marks.move(-1, 0)
    marks.move(1, 1)

    expect(marks.list).toEqual([note('a.md'), note('b.md'), note('c.md')])
  })
})

describe('changing the list around a graph view', () => {
  const graph: Bookmark = {
    kind: 'graph',
    path: '',
    text: 'Work only',
    view: '{"filter":"tag:work"}',
  }
  const viewOf = (marks: InstanceType<typeof Bookmarks>) =>
    marks.list.find((one) => one.kind === 'graph')?.view

  test('keeps the view when another bookmark is removed', () => {
    const marks = store()
    marks.toggle(graph)
    marks.toggle(note('a.md'))

    marks.remove(note('a.md'))

    expect(viewOf(marks)).toBe(graph.view)
  })

  test('keeps the view when the view goes into a group and out again', () => {
    const marks = store()
    marks.toggle(graph)
    const group = marks.addGroup('Views')!

    marks.moveInto(graph, group.path)
    expect(viewOf(marks)).toBe(graph.view)

    marks.moveInto(graph, null)
    expect(viewOf(marks)).toBe(graph.view)
    expect(marks.list.find((one) => one.kind === 'graph')?.parent).toBeUndefined()
  })

  test('keeps the view when the group it sits in is removed', () => {
    const marks = store()
    const group = marks.addGroup('Views')!
    marks.toggle(graph)
    marks.moveInto(graph, group.path)

    marks.remove(group)

    expect(viewOf(marks)).toBe(graph.view)
    expect(marks.list.find((one) => one.kind === 'graph')?.parent).toBeUndefined()
  })

  test('keeps a field this build does not know about', () => {
    const marks = store()
    const newer = { ...note('a.md'), later: 'kept' } as Bookmark
    marks.put('/Notes', [newer, note('b.md')])
    const group = marks.addGroup('Group')!

    marks.moveInto(newer, group.path)
    marks.remove(note('b.md'))

    expect(marks.list[0]).toEqual({ ...newer, parent: group.path })
  })
})

describe('a bookmark found by the id of what it points at (#1068)', () => {
  const ROOT = '/spaces/Work'
  beforeEach(() => sayEntryIds(ids))
  afterEach(() => sayEntryIds(null))
  const ids = {
    idOf: (_root: string, path: string) =>
      (({ 'Notes/Plan.md': 'p', Notes: 'n' }) as Record<string, string>)[path] ?? null,
    pathOf: (_root: string, id: string) =>
      (({ p: 'Notes/Plan.md', n: 'Notes' }) as Record<string, string>)[id] ?? null,
  }

  test('one whose path names nothing goes where its id is, a block keeping its part', () => {
    expect(
      located(
        ROOT,
        [
          { ...note('Old.md'), id: 'p' },
          { kind: 'block', path: 'Old.md#^a1', text: 'a', id: 'p' },
          { ...heading('Old.md', 'Goals'), id: 'p' },
        ],
        ids,
      ).map((one) => one.path),
    ).toEqual(['Notes/Plan.md', 'Notes/Plan.md#^a1', 'Notes/Plan.md'])
  })

  test('one with no id is given the id of what its path names', () => {
    expect(located(ROOT, [note('Notes/Plan.md'), folder('Notes')], ids)).toEqual([
      { ...note('Notes/Plan.md'), id: 'p' },
      { ...folder('Notes'), id: 'n' },
    ])
  })

  test('and the path is read where sync knows neither, or for what points at no file', () => {
    const list = [note('Gone.md'), { ...note('Lost.md'), id: 'x' }, search('plan')]
    expect(located(ROOT, list, ids)).toEqual(list)
  })

  test('the id survives a read, and is left off where it cannot be one', () => {
    expect(
      bookmarkList([
        { kind: 'note', path: 'a.md', text: '', id: 'p' },
        { kind: 'note', path: 'b.md', text: '', id: 7 },
        { kind: 'search', path: '', text: 'x', id: 'p' },
      ]),
    ).toEqual([{ kind: 'note', path: 'a.md', text: '', id: 'p' }, note('b.md'), search('x')])
  })

  test("the account's list is read with its moved bookmarks where they are now", () => {
    const store = new Bookmarks(() => ROOT)
    store.adopt(ROOT, [], 'acct')
    store.adopt(ROOT, [{ ...note('Old.md'), id: 'p' }, note('Notes/Plan.md')], 'acct')
    expect(store.of(ROOT)).toEqual([{ ...note('Notes/Plan.md'), id: 'p' }])
  })

  test('a list written here is not moved, only given ids', () => {
    const store = new Bookmarks(() => ROOT)
    store.put(ROOT, [{ ...note('New.md'), id: 'p' }, note('Other.md')])
    expect(store.of(ROOT)).toEqual([{ ...note('New.md'), id: 'p' }, note('Other.md')])
    store.put(ROOT, [folder('Notes')])
    expect(store.of(ROOT)).toEqual([{ ...folder('Notes'), id: 'n' }])
  })

  test('a bookmark made here carries the id sync has for it', () => {
    const store = new Bookmarks(() => ROOT)
    store.toggle(note('Notes/Plan.md'))
    expect(store.of(ROOT)).toEqual([{ ...note('Notes/Plan.md'), id: 'p' }])
  })
})

describe("the account's list meeting one it has not heard yet", () => {
  test('keeps what was kept here while its push is on its way, and asks to send it', () => {
    const kept = store()
    expect(kept.adopt('/Notes', [], 'acct')).toBeNull()
    kept.toggleAll([note('Mail.url'), note('News.url')])

    expect(kept.adopt('/Notes', [], 'acct')).toEqual([note('Mail.url'), note('News.url')])
    expect(kept.list).toEqual([note('Mail.url'), note('News.url')])
  })

  test("takes the account's word once it has heard the list as it is", () => {
    const kept = store()
    kept.adopt('/Notes', [], 'acct')
    kept.toggle(note('Mail.url'))
    kept.said('/Notes', true, [note('Mail.url')])

    expect(kept.adopt('/Notes', [], 'acct')).toBeNull()
    expect(kept.list).toEqual([])
  })

  test('has not heard a list that changed while the last one was on its way', () => {
    const kept = store()
    kept.adopt('/Notes', [], 'acct')
    kept.toggle(note('Mail.url'))
    const sent = [...kept.list]
    kept.toggle(note('News.url'))
    kept.said('/Notes', true, sent)

    expect(kept.adopt('/Notes', [note('Mail.url')], 'acct')).toEqual([
      note('Mail.url'),
      note('News.url'),
    ])
  })

  test('remembers across runs that the account has not heard it', () => {
    const kept = store()
    kept.adopt('/Notes', [], 'acct')
    kept.toggle(note('Mail.url'))
    kept.said('/Notes', false, [note('Mail.url')])

    expect(store().adopt('/Notes', [], 'acct')).toEqual([note('Mail.url')])
  })
})
