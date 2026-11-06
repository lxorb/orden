import { describe, expect, test } from 'vitest'

import type { Tab } from '../workspace.svelte'
import { unsavedAmong } from './closing-unsaved'

function tab(id: string, note: object): Tab {
  return { id, note } as unknown as Tab
}

const draft = (blank = false) => ({ kind: 'note', path: null, shared: null, blank, dirty: !blank })

describe('the tabs a close would lose words from', () => {
  test('are drafts with words, and nothing else', () => {
    const words = tab('a', draft())
    const empty = tab('b', draft(true))
    const filed = tab('c', { ...draft(), path: '/space/c.md' })
    const site = tab('d', { kind: 'web', path: null, shared: null, blank: false, dirty: false })
    const all = [words, empty, filed, site]

    expect(unsavedAmong(all, all).map((one) => one.id)).toEqual(['a'])
  })

  test('leave out a draft still open in a tab that stays, and count a shared one once', () => {
    const note = draft()
    const left = tab('l', note)
    const right = tab('r', note)

    expect(unsavedAmong([left], [left, right])).toEqual([])
    expect(unsavedAmong([left, right], [left, right]).map((one) => one.id)).toEqual(['l'])
  })
})
