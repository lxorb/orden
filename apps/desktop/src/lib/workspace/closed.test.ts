import { describe, expect, test } from 'vitest'
import { ClosedTabs, MOST_CLOSED } from './closed.svelte'
import type { ClosedTab, Draft } from './session'

function draft(name: string): Draft {
  return { kind: 'note', path: `/Notes/${name}`, name, doc: '', dirty: false, cursor: 0, scroll: 0 }
}

function closed(name: string, paneId = 'p1', at = 0): ClosedTab {
  return { draft: draft(name), paneId, at }
}

describe('the stack of closed tabs', () => {
  test('has nothing to offer to begin with', () => {
    const stack = new ClosedTabs()

    expect(stack.any).toBe(false)
    expect(stack.take()).toBeUndefined()
  })

  test('gives back the last one closed first', () => {
    const stack = new ClosedTabs()
    stack.record(closed('a.md'))
    stack.record(closed('b.md'))

    expect(stack.take()?.draft.name).toBe('b.md')
    expect(stack.take()?.draft.name).toBe('a.md')
    expect(stack.take()).toBeUndefined()
  })

  test('keeps the pane and the place each was closed from', () => {
    const stack = new ClosedTabs()
    stack.record(closed('a.md', 'left', 2))

    const back = stack.take()
    expect(back?.paneId).toBe('left')
    expect(back?.at).toBe(2)
  })

  test('says whether there is anything to reopen', () => {
    const stack = new ClosedTabs()
    stack.record(closed('a.md'))
    expect(stack.any).toBe(true)

    stack.take()
    expect(stack.any).toBe(false)
  })

  test('drops the oldest once it is full', () => {
    const stack = new ClosedTabs()
    for (let index = 0; index < MOST_CLOSED + 5; index++) stack.record(closed(`${index}.md`))

    expect(stack.stack).toHaveLength(MOST_CLOSED)
    expect(stack.stack[0]?.draft.name).toBe('5.md')
    expect(stack.take()?.draft.name).toBe(`${MOST_CLOSED + 4}.md`)
  })

  test('takes the tail of what a session held, however long it was', () => {
    const stack = new ClosedTabs()
    stack.restore(
      Array.from({ length: MOST_CLOSED + 3 }, (_unused, index) => closed(`${index}.md`)),
    )

    expect(stack.stack).toHaveLength(MOST_CLOSED)
    expect(stack.take()?.draft.name).toBe(`${MOST_CLOSED + 2}.md`)
  })
})
