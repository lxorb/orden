import { describe, expect, test } from 'vitest'
import { type Filling, fills } from './panel-tab'
import { TAB_KINDS, type TabKind } from './workspace/tab-kinds'

const tab = (kind: TabKind, more: Partial<Filling> = {}): Filling => ({
  kind,
  markdown: kind === 'note',
  headings: 0,
  footnotes: 0,
  ...more,
})

describe('the panels a tab fills', () => {
  test('are every panel with no tab in front, which has nothing to tell them apart by', () => {
    for (const panel of ['outline', 'links', 'tree', 'ask'] as const)
      expect(fills(panel, null)).toBe(true)
  })

  test('and none this build does not have, which a window may have kept', () => {
    expect(fills('footnotes' as never, null)).toBe(false)
  })

  test('are every panel about the space, beside anything or nothing', () => {
    for (const panel of ['tree', 'search', 'tasks', 'chats', 'time', 'ask'] as const) {
      expect(fills(panel, null)).toBe(true)
      expect(fills(panel, tab('terminal'))).toBe(true)
    }
  })

  test('take the Outline beside a Markdown note with headings or footnotes, and only then', () => {
    expect(fills('outline', tab('note', { headings: 2 }))).toBe(true)
    expect(fills('outline', tab('note', { footnotes: 1 }))).toBe(true)
    expect(fills('outline', tab('note'))).toBe(false)
    expect(fills('outline', tab('note', { markdown: false, headings: 3 }))).toBe(false)
  })

  test('take it beside a page note and a PDF, whose pages it shows', () => {
    expect(fills('outline', tab('pages'))).toBe(true)
    expect(fills('outline', tab('pdf'))).toBe(true)
  })

  test('never beside a terminal, a web page, a canvas or an application', () => {
    for (const kind of ['terminal', 'web', 'canvas', 'application', 'graph', 'chat'] as const) {
      expect(fills('outline', tab(kind, { headings: 5 }))).toBe(false)
    }
  })

  test('take the Links beside what a note can link to', () => {
    expect(
      ['note', 'pdf', 'canvas', 'pages'].every((one) => fills('links', tab(one as TabKind))),
    ).toBe(true)
    expect(fills('links', tab('terminal'))).toBe(false)
    expect(fills('links', tab('web'))).toBe(false)
  })

  test('are said by every kind, so a new kind cannot leave the question open', () => {
    for (const traits of Object.values(TAB_KINDS)) expect(Array.isArray(traits.panels)).toBe(true)
  })
})
