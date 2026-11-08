import { describe, expect, test } from 'vitest'
import { prompt } from './prompt.svelte'

async function settle() {
  for (let round = 0; round < 5; round++) await Promise.resolve()
}

describe('asks that come while another is open', () => {
  test('wait their turn and are answered one by one, none dropped', async () => {
    const first = prompt.choose({ title: 'First.pdf', options: [{ id: 'all', label: 'All' }] })
    const second = prompt.choose({ title: 'Second.pdf', options: [{ id: 'one', label: 'One' }] })
    const third = prompt.confirm({ title: 'Third' })

    expect(prompt.title).toBe('First.pdf')
    prompt.pick('all')
    expect(await first).toBe('all')

    await settle()
    expect(prompt.open).toBe(true)
    expect(prompt.title).toBe('Second.pdf')
    prompt.dismiss()
    expect(await second).toBeNull()

    await settle()
    expect(prompt.title).toBe('Third')
    prompt.submit()
    expect(await third).toBe(true)

    await settle()
    expect(prompt.open).toBe(false)
  })

  test('a ticking choice shows its own tick, not the one of the ask before it', async () => {
    const plain = prompt.choose({ title: 'Plain', options: [{ id: 'a', label: 'A' }] })
    const ticking = prompt.chooseTicking({
      title: 'Ticking',
      options: [{ id: 'b', label: 'B' }],
      tick: 'Remember',
    })

    expect(prompt.tick).toBe('')
    prompt.pick('a')
    await plain

    await settle()
    expect(prompt.tick).toBe('Remember')
    prompt.ticked = true
    prompt.pick('b')
    expect(await ticking).toEqual({ id: 'b', ticked: true })
  })
})

describe('an ask held by a signal', () => {
  test('is taken away when the signal goes, open or still waiting, and the next one comes up', async () => {
    const lock = new AbortController()
    const held = prompt.confirm({ title: 'Delete Bank for good?', until: lock.signal })
    const waiting = prompt.choose({ title: 'Move to', options: [], until: lock.signal })
    const other = prompt.confirm({ title: 'Elsewhere' })

    expect(prompt.title).toBe('Delete Bank for good?')
    lock.abort()
    expect(await held).toBe(false)
    expect(await waiting).toBeNull()

    await settle()
    expect(prompt.title).toBe('Elsewhere')
    prompt.dismiss()
    expect(await other).toBe(false)
  })

  test('is never shown once its signal has gone', async () => {
    const lock = new AbortController()
    lock.abort()
    expect(await prompt.ask({ title: 'New folder', until: lock.signal })).toBeNull()
    expect(prompt.open).toBe(false)
  })
})
