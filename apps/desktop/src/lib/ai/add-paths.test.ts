import { describe, expect, test } from 'vitest'
import { keyed, makersOf, ROAD_HINTS, ROAD_NAMES, roadsOf } from './add-paths'
import { offeredKinds } from './providers'

const DESKTOP = offeredKinds(true, true)
const WEB = offeredKinds(false, true)

describe('adding an AI account', () => {
  test('offers each provider once, as a tile', () => {
    expect(makersOf(DESKTOP).map((one) => one.id)).toEqual([
      'anthropic',
      'openai',
      'google',
      'compatible',
    ])
  })

  test('connects each provider every way it can on the desktop', () => {
    expect(roadsOf('anthropic', DESKTOP)).toEqual(['claude-code', 'anthropic'])
    expect(roadsOf('openai', DESKTOP)).toEqual(['chatgpt', 'codex', 'openai'])
    expect(roadsOf('google', DESKTOP)).toEqual(['gemini-cli', 'gemini'])
    expect(roadsOf('compatible', DESKTOP)).toEqual(['compatible'])
  })

  test('offers only API keys and servers in a browser', () => {
    expect(roadsOf('anthropic', WEB)).toEqual(['anthropic'])
    expect(roadsOf('openai', WEB)).toEqual(['openai'])
    expect(roadsOf('google', WEB)).toEqual(['gemini'])
  })

  test('leaves out a provider whose only way is already taken', () => {
    const left = DESKTOP.filter((kind) => kind !== 'compatible')
    expect(makersOf(left).map((one) => one.id)).not.toContain('compatible')
  })

  test('without Claude Code, connects Anthropic by its API key', () => {
    expect(roadsOf('anthropic', offeredKinds(true, false))).toEqual(['anthropic'])
  })

  test('asks a key only of the ways that need one', () => {
    const asks = DESKTOP.filter(keyed)
    expect(asks.sort()).toEqual(['anthropic', 'compatible', 'gemini', 'openai'])
  })

  test('names and explains every way', () => {
    for (const kind of DESKTOP) {
      expect(ROAD_NAMES[kind]).toBeTruthy()
      if (kind !== 'compatible') expect(ROAD_HINTS[kind]).toBeTruthy()
    }
  })
})
