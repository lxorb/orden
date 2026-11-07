import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({
  token: null as string | null,
  provider: null as object | null,
  native: false,
  os: '',
  phone: false,
  desktop: false,
  stored: new Map<string, string>(),
  invoked: [] as string[],
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
  get isDesktop() {
    return world.desktop
  },
  platform: () => world.os,
  invoke: (command: string) => {
    world.invoked.push(command)
    return new Promise(() => undefined)
  },
}))
vi.mock('../native', () => ({
  Channel: class {
    onmessage: unknown = null
  },
}))
vi.mock('../stored', () => ({
  storedText: (key: string) => world.stored.get(key) ?? null,
  keep: (key: string, value: string) => world.stored.set(key, value),
  forget: (key: string) => world.stored.delete(key),
}))

const { canDictate, deviceHears, engines, whereTo } = await import('./engines.svelte')
const { local } = await import('./local.svelte')

const PARAKEET = { id: 'parakeet', name: 'Parakeet TDT 0.6B v3', bytes: 670_000_000 }

function computer(fit: 'fits' | 'cores', installed: boolean, pace: number | null = null) {
  world.desktop = true
  world.native = true
  local.machine = { fit, model: PARAKEET, installed }
  local.pace = pace
}

beforeEach(() => {
  Object.assign(world, {
    token: null,
    provider: null,
    native: false,
    os: '',
    phone: false,
    desktop: false,
  })
  world.stored.clear()
  world.invoked.length = 0
  local.machine = null
  local.fetching = null
  local.pace = null
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
    expect(world.stored.get('orden:dictation-engine')).toBe('account')
  })

  test('is none again once the chosen one cannot be taken, rather than another', () => {
    world.provider = { id: 'p', kind: 'openai', name: 'OpenAI', model: '' }
    engines.choose('account')
    expect(engines.now()).toBeNull()
  })
})

describe('this computer', () => {
  test('is asked about only on a desktop, and never downloads by being asked', () => {
    expect(engines.offered()).toEqual([])
    expect(world.invoked).toEqual([])
    world.desktop = true
    engines.offered()
    expect(world.invoked).toEqual(['dictation_local'])
  })

  test('is offered first, with Auto, where it can run the model', () => {
    world.token = 'a token'
    computer('fits', false)
    expect(engines.offered()).toEqual(['auto', 'local', 'account'])
    expect(world.invoked).not.toContain('dictation_local_fetch')
  })

  test('is not offered where it cannot keep up', () => {
    world.token = 'a token'
    computer('cores', false)
    expect(engines.offered()).toEqual(['account'])
  })

  test('downloads its model once it or Auto is chosen, and not for another road', async () => {
    world.token = 'a token'
    computer('fits', false)
    engines.choose('account')
    expect(world.invoked).not.toContain('dictation_local_fetch')
    await Promise.resolve()
    expect(world.invoked).not.toContain('dictation_local_fetch')
    engines.choose('local')
    await vi.waitFor(() => expect(world.invoked).toContain('dictation_local_fetch'))
    expect(engines.now()).toBe('local')
  })
})

describe('Auto', () => {
  test('takes the network road while the model is not here', async () => {
    world.provider = { id: 'p', kind: 'openai', name: 'OpenAI', model: '' }
    world.token = 'a token'
    computer('fits', false)
    engines.choose('auto')
    await vi.waitFor(() => expect(world.invoked).toContain('dictation_local_fetch'))
    expect(engines.now()).toBe('provider')
    world.provider = null
    expect(engines.now()).toBe('account')
  })

  test('takes this computer once the model is here and keeps up', () => {
    world.token = 'a token'
    computer('fits', true, 0.08)
    engines.choose('auto')
    expect(engines.now()).toBe('local')
  })

  test('keeps to the network where the model here is too slow', () => {
    world.token = 'a token'
    computer('fits', true, 0.6)
    engines.choose('auto')
    expect(engines.now()).toBe('account')
  })

  test('waits for the download where there is no network road', () => {
    computer('fits', false)
    engines.choose('auto')
    expect(engines.now()).toBe('local')
  })

  test('is not taken on a computer that cannot run the model', () => {
    world.token = 'a token'
    computer('fits', false)
    engines.choose('auto')
    computer('cores', false)
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
