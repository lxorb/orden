import { describe, expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import { type Peer, peersOf, remoteCarets, setPeers } from './carets'

/** A state with the carets extension in it and nothing else, which is all the
 *  extension needs: the decorations are worked out from the state, so nothing here
 *  wants a DOM. */
function stateOn(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [remoteCarets()] })
}

function withPeers(doc: string, peers: readonly Peer[]): EditorState {
  return stateOn(doc).update({ effects: setPeers.of(peers) }).state
}

const MAC: Peer = { id: 1, name: 'Mac', colour: '#3584e4', head: 4, anchor: 4 }
const PHONE: Peer = { id: 2, name: 'iPhone', colour: '#33c7ba', head: 9, anchor: 5 }

/** A caret, or the wash over what somebody has selected. Read off the decoration's
 *  own description, which is untyped, so it is checked rather than trusted. */
function kindOf(decoration: Decoration): string {
  const spec: unknown = decoration.spec
  if (typeof spec !== 'object' || spec === null) return ''

  const named = spec as { class?: unknown; widget?: unknown }
  if (named.widget) return 'caret'
  return typeof named.class === 'string' ? named.class : ''
}

/** Everything the state is drawing, as plain ranges. The field the carets live in
 *  is private, so they are read the way a view reads them: off the facet the
 *  extension provides into. */
function marks(state: EditorState): { from: number; to: number; kind: string }[] {
  const found: { from: number; to: number; kind: string }[] = []

  for (const given of state.facet(EditorView.decorations)) {
    // A set given as a function of a view is one only a view can read. The carets
    // are not given that way.
    if (typeof given === 'function') continue

    const cursor = given.iter()
    while (cursor.value) {
      found.push({ from: cursor.from, to: cursor.to, kind: kindOf(cursor.value) })
      cursor.next()
    }
  }

  return found.sort((one, two) => one.from - two.from || one.kind.localeCompare(two.kind))
}

/** Where each caret sits. */
function carets(state: EditorState): number[] {
  return marks(state)
    .filter((one) => one.kind === 'caret')
    .map((one) => one.from)
}

/** What each of them has selected. */
function ranges(state: EditorState): { from: number; to: number }[] {
  return marks(state)
    .filter((one) => one.kind === 'cm-nib-caret-range')
    .map(({ from, to }) => ({ from, to }))
}

describe('the other people in a note', () => {
  test('are nobody until the app says otherwise', () => {
    const state = stateOn('one\ntwo\n')

    expect(peersOf(state)).toEqual([])
    expect(marks(state)).toEqual([])
  })

  test('are drawn as a bar where each caret is', () => {
    const state = withPeers('one\ntwo\n', [MAC])

    expect(carets(state)).toEqual([4])
    expect(ranges(state)).toEqual([])
  })

  test('wash over what one of them has selected', () => {
    const state = withPeers('one\ntwo\nthree\n', [PHONE])

    expect(ranges(state)).toEqual([{ from: 5, to: 9 }])
    expect(carets(state)).toEqual([9])
  })

  test('are drawn in position order, whatever order they arrive in', () => {
    const state = withPeers('one\ntwo\nthree\n', [PHONE, MAC])

    expect(carets(state)).toEqual([4, 9])
  })

  test('move along when words are written above them', () => {
    const state = withPeers('one\ntwo\n', [MAC])
    const after = state.update({ changes: { from: 0, to: 0, insert: 'nought\n' } }).state

    expect(carets(after)).toEqual([11])
    expect(peersOf(after)[0]?.head).toBe(11)
  })

  test('stay where they are when words are written below them', () => {
    const state = withPeers('one\ntwo\n', [MAC])
    const after = state.update({ changes: { from: 8, to: 8, insert: 'three\n' } }).state

    expect(carets(after)).toEqual([4])
  })

  test('are never drawn outside the note', () => {
    // A caret past the end - a position from a copy of the note that had more in
    // it - lands at the end rather than throwing.
    const state = withPeers('short\n', [{ ...MAC, head: 400, anchor: 400 }])

    expect(carets(state)).toEqual([6])
  })

  test('go when the app says there is nobody left', () => {
    const state = withPeers('one\ntwo\n', [MAC, PHONE])
    const after = state.update({ effects: setPeers.of([]) }).state

    expect(peersOf(after)).toEqual([])
    expect(marks(after)).toEqual([])
  })

  test('are a set, so one leaving leaves the others', () => {
    const state = withPeers('one\ntwo\nthree\n', [MAC, PHONE])
    const after = state.update({ effects: setPeers.of([PHONE]) }).state

    expect(peersOf(after).map((peer) => peer.id)).toEqual([PHONE.id])
    expect(carets(after)).toEqual([9])
  })

  test('cost nothing at all while there are none', () => {
    // Guards the tests above: a doc change with no peers must not rebuild
    // anything, and the field says so by being the very same object.
    const state = stateOn('one\ntwo\n')
    const after = state.update({ changes: { from: 0, to: 0, insert: 'x' } }).state

    expect(marks(after)).toEqual([])
    expect(peersOf(after)).toBe(peersOf(state))
  })
})
