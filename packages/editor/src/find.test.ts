import { getSearchQuery, SearchQuery, setSearchQuery } from '@codemirror/search'
import {
  EditorSelection,
  EditorState,
  type StateEffect,
  type TransactionSpec,
} from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import {
  type FindAsk,
  findExtensions,
  type FindSpec,
  findTally,
  loadFind,
  NO_FIND,
  openFind,
  replaceEverywhere,
  selectEveryMatch,
  termAt,
} from './find'
import { queryFor } from './finding'

beforeAll(async () => {
  await loadFind()
})

const stateOf = (doc: string, selection?: { anchor: number; head: number }): EditorState =>
  EditorState.create({
    doc,
    ...(selection ? { selection: EditorSelection.single(selection.anchor, selection.head) } : {}),
    extensions: [findExtensions()],
  })

function looking(state: EditorState, spec: Partial<typeof NO_FIND> & { query: string }) {
  const { query, ...rest } = { ...NO_FIND, ...spec }
  return state.update({
    effects: setSearchQuery.of(new SearchQuery({ search: query, ...rest })),
  }).state
}

const NOTE = 'the wind came up, and the Wind dropped. a windmill turned. wind.'

describe('counting the matches', () => {
  test('is nothing at all until something is being looked for', () => {
    expect(findTally(stateOf(NOTE))).toEqual({ count: 0, current: -1, capped: false })
  })

  test('counts every one of them', () => {
    const found = findTally(looking(stateOf(NOTE), { query: 'wind' }))
    expect(found.count).toBe(4)
    expect(found.capped).toBe(false)
  })

  test('and says which one the caret is sitting on', () => {
    const at = NOTE.indexOf('windmill')
    const state = looking(stateOf(NOTE, { anchor: at, head: at + 4 }), { query: 'wind' })

    expect(findTally(state).current).toBe(2)
  })

  test('and says nothing about where the caret is when it is on none of them', () => {
    expect(findTally(looking(stateOf(NOTE), { query: 'wind' })).current).toBe(-1)
  })

  test('minds the case when it is asked to', () => {
    const state = stateOf(NOTE)
    expect(findTally(looking(state, { query: 'wind' })).count).toBe(4)
    expect(findTally(looking(state, { query: 'wind', caseSensitive: true })).count).toBe(3)
  })

  test('and whole words when it is asked to', () => {
    const state = stateOf(NOTE)
    expect(findTally(looking(state, { query: 'wind', wholeWord: true })).count).toBe(3)
  })

  test('reads a regular expression as one', () => {
    const state = looking(stateOf(NOTE), { query: 'w[a-z]+d', regexp: true })
    expect(findTally(state).count).toBe(4)
  })

  test('and refuses a regular expression that is not one', () => {
    const state = looking(stateOf(NOTE), { query: 'w(ind', regexp: true })
    expect(getSearchQuery(state).valid).toBe(false)
    expect(findTally(state)).toEqual({ count: 0, current: -1, capped: false })
  })

  test('stops counting past a point, and says so', () => {
    const many = findTally(looking(stateOf('a '.repeat(500)), { query: 'a' }))
    expect(many.count).toBe(300)
    expect(many.capped).toBe(true)
  })
})

describe('the term the bar opens on', () => {
  test('is the words the caret is sitting on', () => {
    const at = NOTE.indexOf('windmill')
    expect(termAt(stateOf(NOTE, { anchor: at, head: at + 8 }))).toBe('windmill')
  })

  test('is nothing where the caret is a caret rather than a selection', () => {
    expect(termAt(stateOf(NOTE, { anchor: 4, head: 4 }))).toBe('')
  })

  test('loses the space a word-wise selection brings with it', () => {
    const at = NOTE.indexOf(' wind')
    expect(termAt(stateOf(NOTE, { anchor: at, head: at + 5 }))).toBe('wind')
  })

  test('is nothing where the selection is half the note', () => {
    const long = 'x'.repeat(200)
    expect(termAt(stateOf(long, { anchor: 0, head: 200 }))).toBe('')
  })

  test('and a selection over two lines comes out as one line can hold it', () => {
    expect(termAt(stateOf('one\ntwo', { anchor: 0, head: 7 }))).toBe('one\\ntwo')
  })
})

describe('selecting every match', () => {
  function selected(state: EditorState): string[] | false {
    let after = state
    const view = {
      get state() {
        return after
      },
      dispatch: (spec: TransactionSpec) => {
        after = after.update(spec).state
      },
    } as unknown as EditorView

    if (!selectEveryMatch(view)) return false
    return after.selection.ranges.map((range) => after.sliceDoc(range.from, range.to))
  }

  test('puts a selection on each of them', () => {
    const state = looking(
      EditorState.create({
        doc: NOTE,
        extensions: [findExtensions(), EditorState.allowMultipleSelections.of(true)],
      }),
      { query: 'wind', wholeWord: true },
    )
    expect(selected(state)).toEqual(['wind', 'Wind', 'wind'])
  })

  test('does nothing where nothing is being looked for', () => {
    expect(selected(stateOf(NOTE))).toBe(false)
  })
})

function viewOn(state: EditorState) {
  let now = state
  const sent: TransactionSpec[] = []
  const view = {
    get state() {
      return now
    },
    dispatch: (spec: TransactionSpec) => {
      sent.push(spec)
      now = now.update(spec).state
    },
  } as unknown as EditorView
  return { view, sent }
}

function asking(state: EditorState, spec: Partial<FindSpec>) {
  return state.update({ effects: setSearchQuery.of(queryFor({ ...NO_FIND, ...spec })) }).state
}

function matched(state: EditorState): string[] {
  const texts: string[] = []
  const cursor = getSearchQuery(state).getCursor(state)
  for (let step = cursor.next(); !step.done; step = cursor.next())
    texts.push(state.sliceDoc(step.value.from, step.value.to))
  return texts
}

function seededOn(doc: string, selected: string, regexp: boolean): string[] {
  const at = doc.indexOf(selected)
  const state = stateOf(doc, { anchor: at, head: at + selected.length })
  return matched(asking(state, { query: termAt(state, regexp), regexp }))
}

describe('the term the bar opens on finds just what was selected', () => {
  const FORMULA = 'a.b(c) and axbc'
  const QUOTED = 'say "\\n" then a\nnew line'
  const PATH = 'C:\\\\Users or C:\\Users'

  for (const regexp of [false, true]) {
    const mode = regexp ? 'as a regular expression' : 'as plain text'

    test(`a backslash and an n, ${mode}`, () => {
      expect(seededOn(QUOTED, '"\\n"', regexp)).toEqual(['"\\n"'])
    })

    test(`two backslashes, ${mode}`, () => {
      expect(seededOn(PATH, 'C:\\\\Users', regexp)).toEqual(['C:\\\\Users'])
    })

    test(`one backslash, ${mode}`, () => {
      expect(seededOn(PATH, 'or C:\\Users', regexp)).toEqual(['or C:\\Users'])
    })

    test(`characters a pattern would read as its own, ${mode}`, () => {
      expect(seededOn(FORMULA, 'a.b(c)', regexp)).toEqual(['a.b(c)'])
    })

    test(`a selection over two lines, ${mode}`, () => {
      expect(seededOn('one\ntwo, one two', 'one\ntwo', regexp)).toEqual(['one\ntwo'])
    })
  }

  test('a pattern seeded from a selection replaces only that selection', () => {
    const at = FORMULA.indexOf('a.b(c)')
    const state = stateOf(FORMULA, { anchor: at, head: at + 6 })
    const { view } = viewOn(
      asking(state, { query: termAt(state, true), regexp: true, replace: 'y' }),
    )

    expect(replaceEverywhere(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('y and axbc')
  })

  test('the ask that opens the bar carries the term for either mode', () => {
    const at = FORMULA.indexOf('a.b(c)')
    const { view, sent } = viewOn(stateOf(FORMULA, { anchor: at, head: at + 6 }))

    expect(openFind(view)).toBe(true)
    const effects = sent.flatMap((spec) => spec.effects ?? []) as StateEffect<FindAsk>[]
    expect(effects.map((effect) => effect.value)).toEqual([
      { replace: false, seed: 'a.b(c)', pattern: 'a\\.b\\(c\\)' },
    ])
  })
})

describe('a typed query and replacement', () => {
  test('still read a typed \\n as a new line when looking', () => {
    const state = asking(stateOf('one\ntwo'), { query: 'one\\ntwo' })
    expect(matched(state)).toEqual(['one\ntwo'])
  })

  test('write a plain replacement exactly as it was typed', () => {
    const { view } = viewOn(
      asking(stateOf('the wind'), { query: 'wind', replace: 'C:\\new\\table' }),
    )

    expect(replaceEverywhere(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('the C:\\new\\table')
  })

  test('and two typed backslashes as two', () => {
    const { view } = viewOn(asking(stateOf('the wind'), { query: 'wind', replace: 'a\\\\b' }))

    expect(replaceEverywhere(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('the a\\\\b')
  })

  test('while a pattern replacement still writes \\n as a new line', () => {
    const { view } = viewOn(
      asking(stateOf('the wind'), { query: 'w(i)nd', regexp: true, replace: '$1\\n' }),
    )

    expect(replaceEverywhere(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('the i\n')
  })
})
