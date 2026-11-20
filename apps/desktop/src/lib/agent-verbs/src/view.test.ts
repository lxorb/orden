import { expect, test } from 'vitest'
import { tabOverview, workspace } from '../../workspace/src/api'
import { done } from './call'
import { Refused } from './problem'
import { verbsOf } from './table'
import { onViewSlip } from './view'

const READER = { agent: null }
test('a verb never moves what the reader sees: what it moved is put back and heard as a slip', async () => {
  const slips: string[] = []
  const unhear = onViewSlip((verb) => slips.push(verb))
  const pane = workspace.panes.focusedId
  const shown = () => workspace.panes.all.find((one) => one.id === pane)?.activeTabId ?? null
  const before = shown()
  const verbs = verbsOf({
    still: () => done(null),
    jumps: () => {
      tabOverview.open = true
      workspace.panes.activate(pane, 'a-tab-the-agent-opened')
      return done(null)
    },
    fails: () => {
      tabOverview.open = true
      throw new Refused('failed', 'broke halfway')
    },
  })
  expect(await verbs.still?.('still', {}, READER)).toEqual(done(null))
  expect(await verbs.jumps?.('jumps', {}, READER)).toEqual(done(null))
  expect(tabOverview.open).toBe(false)
  expect(shown()).toBe(before)
  expect(await verbs.fails?.('fails', {}, READER)).toMatchObject({ code: 'failed' })
  expect(tabOverview.open).toBe(false)
  expect(slips).toEqual(['jumps', 'fails'])
  unhear()
})
