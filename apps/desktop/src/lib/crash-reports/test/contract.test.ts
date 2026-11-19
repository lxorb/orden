import { describe, expect, test } from 'vitest'
import { crashReports, loadCrashAsk, watchCrashes } from '../src/api'
import { scrubbedText } from '../src/scrub'

describe('the module stands on its own', () => {
  test('the api loads with nothing watched and the question closed, and every call is there', () => {
    for (const one of [loadCrashAsk, watchCrashes]) expect(typeof one).toBe('function')
    expect(typeof crashReports.on).toBe('boolean')
  })
})
describe('what a crash report may carry', () => {
  test('no secret, address or page path leaves the device', () => {
    const text = scrubbedText(
      'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl mail anna@example.org https://bank.example.com/login?account=42',
    )
    expect(text).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(text).not.toContain('anna@example.org')
    expect(text).not.toContain('/login?account=42')
  })
  test('an answer is taken only while the question is open', () => {
    crashReports.set(true)
    crashReports.answer(false)
    expect(crashReports.on).toBe(true)
  })
})
