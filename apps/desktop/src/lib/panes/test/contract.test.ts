import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { closedAround, Panes, pane, panesIn, paneToward, successor } from '../src/api'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('reaches no app module but the platform', () => {
    const reached = readdirSync(SRC)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .flatMap((name) =>
        [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '(\.\.[^']*)'/g)].map(
          (found) => found[1],
        ),
      )
    expect([...new Set(reached)]).toEqual(['../../platform/src/api'])
  })
})

describe('the panes of a window', () => {
  test('one pane splits beside itself, is found toward its side, and closes back to one', () => {
    let changed = 0
    const panes = new Panes(() => (changed += 1))
    const first = panesIn(panes.frame)[0]?.id ?? ''
    const made = panes.split('row', first)?.id ?? ''
    expect(panesIn(panes.frame).map((one) => one.id)).toEqual([first, made])
    expect(paneToward(panes.frame, first, 'right')?.id).toBe(made)
    expect(panes.close(made)).toBe(true)
    expect(panesIn(panes.frame).map((one) => one.id)).toEqual([first])
    expect(panes.close(first)).toBe(false)
    expect(changed).toBe(2)
  })

  test('folding every pane into one keeps the one kept as it was, its stacked tabs too', () => {
    const panes = new Panes(() => undefined)
    const first = panesIn(panes.frame)[0]?.id ?? ''
    const made = panes.split('row', first)?.id ?? ''
    panes.activate(made, 't')
    panes.setStacked(made, true)
    panes.collapse()
    expect(panesIn(panes.frame)).toEqual([
      { kind: 'pane', id: made, activeTabId: 't', linked: false, stacked: true },
    ])
  })

  test('a lone pane has nothing toward any side', () => {
    expect(paneToward(pane('a'), 'a', 'left')).toBeNull()
  })

  test('closing around a tab keeps the side it was asked to keep', () => {
    const strip = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
    expect(closedAround(strip, 'b', 'others').map((one) => one.id)).toEqual(['a', 'c', 'd'])
    expect(closedAround(strip, 'b', 'right').map((one) => one.id)).toEqual(['c', 'd'])
    expect(closedAround(strip, 'x', 'all')).toEqual([])
  })

  test('the tab shown after one closes is the last seen still open', () => {
    expect(successor(['a', 'c'], ['b', 'c', 'a'])).toBe('c')
    expect(successor(['a', 'c'], [], 1)).toBe('c')
  })
})
