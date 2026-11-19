import { setSearchQuery } from '@codemirror/search'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { findExtensions, type FindSpec, loadFind, NO_FIND, replaceEverywhere, replaceHere } from './find'
import { queryFor } from './finding'

beforeAll(async () => {
  await loadFind()
})

function replaced(doc: string, spec: Partial<FindSpec>, every = true): string {
  let state = EditorState.create({ doc, extensions: [findExtensions()] })
  state = state.update({ effects: setSearchQuery.of(queryFor({ ...NO_FIND, ...spec })) }).state
  const view = {
    get state() {
      return state
    },
    dispatch: (one: TransactionSpec) => {
      state = state.update(one).state
    },
  } as unknown as EditorView
  if (every) replaceEverywhere(view)
  else {
    replaceHere(view)
    replaceHere(view)
  }
  return state.doc.toString()
}

describe('a pattern replacement naming a group that took no part in the match', () => {
  test('writes nothing for it in Replace all, as JavaScript does', () => {
    const spec = { query: '(\\d+)(px)?', regexp: true, replace: '[$1$2]' }
    expect(replaced('10px and 20 wide', spec)).toBe('[10px] and [20] wide')
  })

  test('writes nothing for it in Replace', () => {
    const spec = { query: '(Mr\\. )?(\\w+) Smith', regexp: true, replace: '$1$2 Jones' }
    expect(replaced('Anna Smith', spec, false)).toBe('Anna Jones')
  })
})
