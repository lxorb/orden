import { describe, expect, test } from 'vitest'
import { aheadOf } from './gate.svelte'

const kept = (said: Record<string, string>) => (key: string) => said[key] ?? null
describe('what the first frame shows', () => {
  test('is the setup when one was left part way, in the app or in a browser', () => {
    const left = kept({ 'orden:setup': '{"step":"heard","answers":{}}' })
    expect(aheadOf(true, left)).toBe('setup')
    expect(aheadOf(false, left)).toBe('setup')
  })
  test('is the setup on the very first launch of the app', () => {
    expect(aheadOf(true, kept({}))).toBe('setup')
  })
  test('is the app for someone who finished the setup, used Orden before, or is waiting for an account', () => {
    expect(aheadOf(true, kept({ 'orden:setup': '"done"' }))).toBeNull()
    expect(aheadOf(true, kept({ 'orden:seeded': 'yes' }))).toBeNull()
    expect(aheadOf(true, kept({ 'orden:workspace': '{"tabs":[]}' }))).toBeNull()
    expect(aheadOf(false, kept({ 'orden:setup': '"waiting"' }))).toBeNull()
  })
  test('is the app on a first visit in a browser, where the setup waits for an account', () => {
    expect(aheadOf(false, kept({}))).toBeNull()
  })
})
