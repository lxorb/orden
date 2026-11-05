import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Which roads dictation offers and takes (#1128): only those that can be taken here,
 *  the reader's own provider first; none taken before one is chosen; and the device's
 *  own recogniser only where one works, which a desktop's WebView2 and CEF do not. */

const world = vi.hoisted(() => ({
  token: null as string | null,
  provider: null as object | null,
  native: false,
  os: '',
  phone: false,
  stored: new Map<string, string>(),
}))

vi.mock('../account.svelte', () => ({
  account: {
    get accountToken() {
      return world.token
    },
  },
}))
vi.mock('../ai/hears', () => ({ transcriberNow: () => world.provider }))
vi.mock('../mobile/bridge', () => ({
  method: (name: string) => (name === 'dictates' && world.phone ? () => true : undefined),
}))
vi.mock('../tauri', () => ({
  get isNative() {
    return world.native
  },
  platform: () => world.os,
}))
vi.mock('../stored', () => ({
  storedText: (key: string) => world.stored.get(key) ?? null,
  keep: (key: string, value: string) => world.stored.set(key, value),
  forget: (key: string) => world.stored.delete(key),
}))

const { canDictate, deviceHears, engines, whereTo } = await import('./engines.svelte')

beforeEach(() => {
  Object.assign(world, { token: null, provider: null, native: false, os: '', phone: false })
  world.stored.clear()
  engines.choose(null)
})

afterEach(() => {
  delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
})

describe('the roads offered', () => {
  test('are none with no provider, no account and no recogniser', () => {
    expect(engines.offered()).toEqual([])
    expect(canDictate()).toBe(false)
  })

  test('are the provider first, then the account', () => {
    world.token = 'a token'
    world.provider = { id: 'p', kind: 'openai', name: 'OpenAI', model: '' }
    expect(engines.offered()).toEqual(['provider', 'account'])
  })

  test('take the phone’s recogniser where the activity has one', () => {
    world.phone = true
    expect(engines.offered()).toEqual(['device'])
  })

  test('take the web’s recogniser on a Mac or in a browser', () => {
    Object.assign(globalThis, { webkitSpeechRecognition: vi.fn() })
    expect(deviceHears()).toBe(true)
    world.native = true
    world.os = 'macos'
    expect(deviceHears()).toBe(true)
  })

  test('but not in WebView2 or CEF, which carry the name and no service', () => {
    Object.assign(globalThis, { webkitSpeechRecognition: vi.fn() })
    world.native = true
    world.os = 'windows'
    expect(deviceHears()).toBe(false)
    world.os = 'linux'
    expect(deviceHears()).toBe(false)
  })
})

describe('the road taken', () => {
  test('is none until one is chosen, whatever is offered', () => {
    world.token = 'a token'
    expect(engines.now()).toBeNull()
  })

  test('is the one chosen, kept for this device', () => {
    world.token = 'a token'
    engines.choose('account')
    expect(engines.now()).toBe('account')
    expect(world.stored.get('nib:dictation-engine')).toBe('account')
  })

  test('is none again once the chosen one cannot be taken, rather than another', () => {
    world.provider = { id: 'p', kind: 'openai', name: 'OpenAI', model: '' }
    engines.choose('account')
    expect(engines.now()).toBeNull()
  })
})

describe('where a provider sends audio', () => {
  test('is this machine for a server on it', () => {
    const local = {
      id: 'l',
      kind: 'compatible',
      name: 'Whisper',
      model: '',
      baseUrl: 'http://localhost:8080',
    } as const
    expect(whereTo(local)).toEqual({ local: true, host: 'localhost' })
    expect(whereTo({ ...local, baseUrl: 'http://127.0.0.1:9000/v1' }).local).toBe(true)
  })

  test('and the server’s name otherwise', () => {
    expect(whereTo({ id: 'o', kind: 'openai', name: 'OpenAI', model: '' })).toEqual({
      local: false,
      host: 'OpenAI',
    })
    expect(
      whereTo({
        id: 'g',
        kind: 'compatible',
        name: 'Groq',
        model: '',
        baseUrl: 'https://api.groq.com/openai',
      }).host,
    ).toBe('api.groq.com')
  })
})
