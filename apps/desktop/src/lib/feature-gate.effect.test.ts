import { flushSync } from 'svelte'
import { beforeEach, describe, expect, test } from 'vitest'
import { setWord } from './kind-choice'
import { hiddenKinds, PASS_WORD, TIME_WORD } from './settings.svelte'
import { whenPassOn, whenTimeOn } from './feature-gate.svelte'
import { openPass } from './pass/open'
import { workspace } from './workspace.svelte'

beforeEach(() => {
  localStorage.clear()
  hiddenKinds.restore()
})

describe('a feature turned on and off while the app runs', () => {
  test('Pass starts once, and its tab closes and it goes quiet when turned off', () => {
    const said: string[] = []
    whenPassOn(
      () => void said.push('run'),
      () => void said.push('off'),
    )
    flushSync()
    expect(said).toEqual([])

    setWord(PASS_WORD, true)
    flushSync()
    expect(openPass()?.kind).toBe('pass')
    expect(said).toEqual(['run'])

    setWord(PASS_WORD, false)
    flushSync()
    expect(workspace.tabs.some((one) => one.kind === 'pass')).toBe(false)
    expect(said).toEqual(['run', 'off'])

    setWord(PASS_WORD, true)
    flushSync()
    setWord(PASS_WORD, false)
    flushSync()
    expect(said).toEqual(['run', 'off', 'off'])
  })

  test('the time tracker starts once it is turned on', () => {
    let ran = 0
    whenTimeOn(() => {
      ran++
    })
    flushSync()
    expect(ran).toBe(0)
    setWord(TIME_WORD, true)
    flushSync()
    setWord(TIME_WORD, false)
    flushSync()
    setWord(TIME_WORD, true)
    flushSync()
    expect(ran).toBe(1)
  })
})
