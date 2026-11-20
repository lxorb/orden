import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

const KEY = 'orden:setup'
vi.stubGlobal('localStorage', memoryStorage())
async function fresh() {
  vi.resetModules()
  return (await import('./setup-state.svelte')).setup
}
async function relaunched() {
  vi.resetModules()
  const [{ gate }, { setup }] = await Promise.all([import('./gate.svelte'), import('./setup-state.svelte')])
  gate.restore()
  if (gate.showing) setup.resume()
  return setup
}
beforeEach(() => localStorage.clear())
describe('the first-launch setup', () => {
  test('stays away from people who used Orden before it existed', async () => {
    const setup = await relaunched()
    expect(setup.showing).toBe(false)
  })
  test('stays away from people who finished it, even on a fresh start', async () => {
    localStorage.setItem(KEY, JSON.stringify('done'))
    const setup = await relaunched()
    setup.begin(false)
    expect(setup.showing).toBe(false)
  })
  test('opens on a fresh start at the log in, or past it when signed in', async () => {
    const setup = await fresh()
    setup.begin(false)
    expect(setup.showing).toBe(true)
    expect(setup.step).toBe('account')
    localStorage.clear()
    const signed = await fresh()
    signed.begin(true)
    expect(signed.step).toBe('appearance')
  })
  test('comes back at the step it was left on, with its answers', async () => {
    const setup = await fresh()
    setup.begin(false)
    setup.next(setup.step)
    setup.next(setup.step)
    setup.answer({ code: 'no' })
    expect(setup.step).toBe('heard')
    const again = await relaunched()
    expect(again.showing).toBe(true)
    expect(again.step).toBe('heard')
    expect(again.answers.code).toBe('no')
  })
  test('opened again goes back the way it came, past no step it skipped', async () => {
    const setup = await fresh()
    setup.begin(true)
    setup.next(setup.step)
    setup.next(setup.step)
    expect(setup.step).toBe('browser')
    const again = await relaunched()
    expect(again.step).toBe('browser')
    expect(again.canGoBack).toBe(true)
    again.back()
    expect(again.step).toBe('heard')
    again.back()
    expect(again.step).toBe('appearance')
    expect(again.canGoBack).toBe(false)
  })
  test('opened again after signing in never goes back to the log in', async () => {
    const setup = await fresh()
    setup.begin(false)
    setup.signedIn = true
    setup.next(setup.step)
    setup.next(setup.step)
    const again = await relaunched()
    expect(again.step).toBe('heard')
    again.back()
    again.back()
    expect(again.step).toBe('appearance')
  })
  test('opened again from what an older Orden kept still goes back', async () => {
    localStorage.setItem(KEY, JSON.stringify({ step: 'heard', answers: {} }))
    const again = await relaunched()
    expect(again.step).toBe('heard')
    again.back()
    expect(again.step).toBe('appearance')
  })
  test('goes back the way it came, and no further than the start', async () => {
    const setup = await fresh()
    setup.begin(false)
    expect(setup.canGoBack).toBe(false)
    setup.next(setup.step)
    setup.next(setup.step)
    setup.back()
    expect(setup.step).toBe('appearance')
    setup.back()
    setup.back()
    expect(setup.step).toBe('account')
  })
  test('never goes back to the log in once signed in', async () => {
    const setup = await fresh()
    setup.begin(false)
    setup.signedIn = true
    setup.next(setup.step)
    expect(setup.step).toBe('appearance')
    expect(setup.canGoBack).toBe(false)
    setup.back()
    expect(setup.step).toBe('appearance')
    setup.next(setup.step)
    setup.back()
    expect(setup.step).toBe('appearance')
  })
  test('moves on late only from the step that asked for it', async () => {
    const setup = await fresh()
    setup.begin(false)
    setup.next(setup.step)
    setup.next(setup.step)
    setup.back()
    setup.next('heard')
    expect(setup.step).toBe('appearance')
    setup.next('appearance')
    expect(setup.step).toBe('heard')
  })
  test('is over for good once finished', async () => {
    const setup = await fresh()
    setup.begin(false)
    setup.finish()
    expect(setup.showing).toBe(false)
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify('done'))
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
