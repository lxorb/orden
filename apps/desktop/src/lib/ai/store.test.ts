import { beforeEach, describe, expect, test, vi } from 'vitest'

const file = { text: null as string | null, stamp: 0 }
let heard: (() => void)[] = []

vi.mock('./accounts-file', () => ({
  COPY: 'nib:ai-accounts',
  STALE: 'stale',
  readKept: () => Promise.resolve({ text: file.text, stamp: String(file.stamp) }),
  writeKept: (text: string, stamp: string) => {
    if (stamp !== String(file.stamp)) return Promise.reject(new Error('stale'))
    file.text = text
    file.stamp += 1
    for (const one of heard) one()
    return Promise.resolve(String(file.stamp))
  },
  hearChanges: (on: () => void) => {
    heard.push(on)
    return Promise.resolve()
  },
}))

const listModels = vi.fn((_provider: unknown) =>
  Promise.resolve(['babbage-002', 'gpt-4.1', 'gpt-5.4-mini', 'gpt-5.5', 'tts-1']),
)
vi.mock('./complete', () => ({ listModels: (provider: unknown) => listModels(provider) }))

function storage(entries: Record<string, string> = {}): Storage {
  const held = new Map(Object.entries(entries))
  return {
    get length() {
      return held.size
    },
    clear: () => held.clear(),
    getItem: (key) => held.get(key) ?? null,
    key: (index) => [...held.keys()][index] ?? null,
    removeItem: (key) => held.delete(key),
    setItem: (key, value) => held.set(key, value),
  }
}

async function windowOn(profile: Storage) {
  vi.stubGlobal('localStorage', profile)
  vi.resetModules()
  const { ai } = await import('./store.svelte')
  await vi.waitFor(() => {
    expect(heard.length).toBeGreaterThan(0)
  })
  return ai
}

async function settled() {
  for (let round = 0; round < 10; round++) await Promise.resolve()
  await new Promise((done) => setTimeout(done, 0))
}

const EARLIER = JSON.stringify({
  providers: [
    { id: 'claude-code', kind: 'claude-code', name: '', model: '' },
    { id: 'anthropic', kind: 'anthropic', name: '', model: 'claude-opus-5-5' },
  ],
  defaultId: 'anthropic',
  uses: { rewrite: 'claude-code' },
})

beforeEach(() => {
  file.text = null
  file.stamp = 0
  heard = []
})

describe('moving the accounts out of one window', () => {
  test('a first window writes what it kept before, with the same ids', async () => {
    const profile = storage({ 'nib:ai': EARLIER })
    const ai = await windowOn(profile)
    await settled()

    const kept = JSON.parse(file.text ?? '{}') as { accounts: { id: string }[]; active: object }
    expect(kept.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic'])
    expect(kept.active).toEqual({ claude: 'anthropic' })
    expect(ai.providerFor('block')?.id).toBe('anthropic')
    expect(profile.getItem('nib:ai-moved')).toBe('1')
    expect(profile.getItem('nib:ai')).toBe(EARLIER)
  })

  test('a window on another engine’s profile starts with the same accounts', async () => {
    await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()

    const other = await windowOn(storage())
    await settled()
    expect(other.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic'])
    expect(other.provider('claude')?.id).toBe('anthropic')
  })

  test('a second profile with rows of its own brings the missing ones, once', async () => {
    await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()

    const theirs = storage({
      'nib:ai': JSON.stringify({
        providers: [
          { id: 'anthropic', kind: 'anthropic', name: 'theirs', model: '' },
          { id: 'openai', kind: 'openai', name: '', model: 'gpt-6-astra' },
        ],
        defaultId: 'openai',
      }),
    })
    const other = await windowOn(theirs)
    await settled()
    expect(other.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic', 'openai'])
    expect(other.accounts[1]?.name).toBe('')

    other.remove('openai')
    await settled()
    const again = await windowOn(theirs)
    await settled()
    expect(again.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic'])
  })
})

describe('two windows at once', () => {
  test('a switch in one is heard by the other', async () => {
    const first = await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()
    const second = await windowOn(storage())
    await settled()

    second.activate('claude-code')
    await settled()
    expect(first.provider('claude')?.id).toBe('claude-code')
  })

  test('changes made over the same text both stay', async () => {
    const first = await windowOn(storage({ 'nib:ai': EARLIER }))
    await settled()
    const second = await windowOn(storage())
    await settled()

    heard = []
    first.update('anthropic', { name: 'Work' })
    second.add('openai')
    await settled()

    const kept = JSON.parse(file.text ?? '{}') as { accounts: { id: string; name: string }[] }
    expect(kept.accounts.map((one) => one.id)).toEqual(['claude-code', 'anthropic', 'openai'])
    expect(kept.accounts[1]?.name).toBe('Work')
  })
})

describe('an account kept on a model nobody can talk to', () => {
  const KEPT = (model: string) =>
    JSON.stringify({
      providers: [{ id: 'openai', kind: 'openai', name: '', model }],
      defaultId: 'openai',
      uses: {},
    })

  test('is moved to the one a key given now starts on, and written so', async () => {
    listModels.mockClear()
    const ai = await windowOn(storage({ 'nib:ai': KEPT('babbage-002') }))
    await vi.waitFor(() => {
      expect(ai.accounts[0]?.model).toBe('gpt-5.5')
    })
    await settled()
    expect(JSON.parse(file.text ?? '{}').accounts[0].model).toBe('gpt-5.5')
    expect(listModels).toHaveBeenCalledTimes(1)
  })

  test('one that can talk is left as it was, and nothing is asked', async () => {
    listModels.mockClear()
    const ai = await windowOn(storage({ 'nib:ai': KEPT('gpt-4.1') }))
    await settled()
    expect(ai.accounts[0]?.model).toBe('gpt-4.1')
    expect(listModels).not.toHaveBeenCalled()
  })

  test('a list that cannot be read leaves it, to be tried again', async () => {
    listModels.mockClear()
    listModels.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    const ai = await windowOn(storage({ 'nib:ai': KEPT('davinci-002') }))
    await settled()
    expect(listModels).toHaveBeenCalled()
    expect(ai.accounts.find((one) => one.id === 'openai')?.model).toBe('davinci-002')
  })
})
