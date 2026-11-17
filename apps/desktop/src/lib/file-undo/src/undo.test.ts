import { describe, expect, test } from 'vitest'
import { FileActions } from './undo.svelte'

function gesture() {
  let end: (() => void) | undefined
  const until = new Promise<void>((go) => (end = go))
  return { until, end: () => end?.() }
}

describe('what an undo waits for', () => {
  test('is nothing where no gesture is under way', async () => {
    await expect(new FileActions().landed()).resolves.toBe(true)
  })

  test('is every gesture that overlapped, not only the first', async () => {
    const actions = new FileActions()
    const first = gesture()
    const second = gesture()
    const one = actions.batch(() => first.until)
    const two = actions.batch(() => second.until)

    let landed = false
    void actions.landed().then(() => (landed = true))
    first.end()
    await one
    await Promise.resolve()
    expect(landed).toBe(false)

    second.end()
    await two
    await Promise.resolve()
    expect(landed).toBe(true)
  })
})

describe("a file explorer's change outside the spaces (#1164)", () => {
  const said = (steps: Parameters<FileActions['record']>[0]) => {
    const actions = new FileActions()
    actions.record(steps)
    return actions.label
  }

  test('is told by the change it is, not by what it replaced', () => {
    const ticket = { path: '/a/b.txt', back: '/t', at: 1 }
    expect(
      said({
        kind: 'outside',
        steps: [
          { op: 'replaced', tickets: [ticket] },
          { op: 'moved', pairs: [{ from: '/x/b.txt', to: '/a/b.txt' }] },
        ],
      }),
    ).toBe('Undo moving b.txt')
    expect(
      said({
        kind: 'outside',
        steps: [{ op: 'moved', pairs: [{ from: '/a/a.txt', to: '/a/b.txt' }] }],
      }),
    ).toBe('Undo renaming b.txt')
    expect(said({ kind: 'outside', steps: [{ op: 'trashed', tickets: [ticket, ticket] }] })).toBe(
      'Undo the deletion',
    )
  })

  test('can be done again', () => {
    const actions = new FileActions()
    actions.record({ kind: 'outside', steps: [{ op: 'made', path: '/a/New folder' }] })
    actions.drop()
    expect(actions.canRedo).toBe(true)
  })
})
