import { beforeEach, describe, expect, test, vi } from 'vitest'

const KEY = 'orden:setup'

const kept = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
})

async function fresh() {
  vi.resetModules()
  return (await import('./setup-state.svelte')).setup
}

async function relaunched() {
  vi.resetModules()
  const [{ gate }, { setup }] = await Promise.all([
    import('./gate.svelte'),
    import('./setup-state.svelte'),
  ])
  gate.restore()
  if (gate.showing) setup.resume()
  return setup
}

beforeEach(() => kept.clear())

describe('the first-launch setup', () => {
  test('stays away from people who used Orden before it existed', async () => {
    const setup = await relaunched()
    expect(setup.showing).toBe(false)
  })

  test('stays away from people who finished it, even on a fresh start', async () => {
    kept.set(KEY, JSON.stringify('done'))
    const setup = await relaunched()
    setup.begin(false)
    expect(setup.showing).toBe(false)
  })

  test('opens on a fresh start at the log in, or past it when signed in', async () => {
    const setup = await fresh()
    setup.begin(false)
    expect(setup.showing).toBe(true)
    expect(setup.step).toBe('account')

    kept.clear()
    const signed = await fresh()
    signed.begin(true)
    expect(signed.step).toBe('appearance')
  })

  test('comes back at the step it was left on, with its answers', async () => {
    const setup = await fresh()
    setup.begin(false)
    setup.next()
    setup.next()
    setup.answer({ code: 'no' })
    expect(setup.step).toBe('heard')

    const again = await relaunched()
    expect(again.showing).toBe(true)
    expect(again.step).toBe('heard')
    expect(again.answers.code).toBe('no')
  })

  test('goes back the way it came, and no further than the start', async () => {
    const setup = await fresh()
    setup.begin(false)
    expect(setup.canGoBack).toBe(false)
    setup.next()
    setup.next()
    setup.back()
    expect(setup.step).toBe('appearance')
    setup.back()
    setup.back()
    expect(setup.step).toBe('account')
  })

  test('is over for good once finished', async () => {
    const setup = await fresh()
    setup.begin(false)
    setup.finish()
    expect(setup.showing).toBe(false)
    expect(kept.get(KEY)).toBe(JSON.stringify('done'))

    const again = await relaunched()
    again.begin(false)
    expect(again.showing).toBe(false)
  })

  test('lists each import problem once, in the order they came', async () => {
    const setup = await fresh()
    setup.tell('2 notes from Notion could not be imported')
    setup.tell(null)
    setup.tell('Containers stay in Firefox')
    expect(setup.issues.map((one) => one.text)).toEqual([
      '2 notes from Notion could not be imported',
      'Containers stay in Firefox',
    ])
  })
})
