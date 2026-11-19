import { expect, test } from 'vitest'
import { parseQuery } from '@orden/scan/search/query'
import { workspace } from '../../workspace/src/api'
import { unsavedHits } from './unsaved-hits'

test('a search of the space finds the words of a note with no file, by its tab', () => {
  workspace.collapsePanes()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank()
  const tab = workspace.active
  if (!tab) throw new Error('nothing opened')
  tab.note.live.replace('# Plan\n\nbuy milk')
  expect(unsavedHits(parseQuery('milk'), 's', 10)).toEqual([
    expect.objectContaining({ tab: tab.id, line: 2, text: 'buy milk' }),
  ])
  expect(unsavedHits(parseQuery('milk'), 'another', 10)).toEqual([])
})
