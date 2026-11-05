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
