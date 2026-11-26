// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { readDraft } from '../../session/src/api'
import { holdsRetiredTab, isRetiredChat } from '../../documents/src/retired-tabs'

describe('a tab of a chat service gone', () => {
  const remote = { kind: 'channel', path: null, name: 'Ada', doc: 'connected-chat\nmail\na\nt1' }
  const own = { kind: 'channel', path: '/s/Team.chat', name: 'Team', doc: '' }
  const adding = { kind: 'connect', path: null, name: 'Add a chat account', doc: '' }
  test('is not restored, while an Orden chat is', () => {
    expect(readDraft(remote)).toBeNull()
    expect(readDraft(adding)).toBeNull()
    expect(readDraft(own)?.kind).toBe('channel')
    expect(isRetiredChat(remote.doc)).toBe(true)
    expect(isRetiredChat('01JD0000000000000000000000')).toBe(false)
  })
  test('is found anywhere in a saved layout, so the reader is told', () => {
    const pane = (tabs: unknown[]) => ({ kind: 'pane', pane: { id: 'p', tabs, active: 0 } })
    const split = (tabs: unknown[]) => ({
      frame: { kind: 'split', sides: [pane([own]), pane(tabs)] },
    })
    expect(holdsRetiredTab(split([remote]))).toBe(true)
    expect(holdsRetiredTab(split([adding]))).toBe(true)
    expect(holdsRetiredTab(split([own]))).toBe(false)
  })
})
