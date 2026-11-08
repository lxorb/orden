import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccountDouble } from '../account-double'

const server = vi.hoisted(() => ({
  set: false,
  tail: '',
  refuse: '',
  models: ['gpt-6-astra', 'gpt-5.6-sol'] as string[],
  asked: [] as string[],
  held: null as Promise<void> | null,
}))

vi.mock('../api', () => ({
  api: {
    setAskKey: async (_token: string, key: string) => {
      server.asked.push(`put ${key}`)
      await server.held
      if (server.refuse) return Promise.reject(new Error(server.refuse))

      server.set = true
      server.tail = key.slice(-4)
      return Promise.resolve({ set: server.set, tail: server.tail })
    },
    removeAskKey: () => {
      server.asked.push('remove')
      if (server.refuse) return Promise.reject(new Error(server.refuse))

      server.set = false
      server.tail = ''
      return Promise.resolve({ set: false, tail: '' })
    },
    askModels: async () => {
      server.asked.push('models')
      await server.held
      return Promise.resolve({ models: server.models })
    },
  },
}))

vi.mock('../account.svelte', async () => ({
  account: (await import('../account-double')).accountDouble(),
}))

vi.mock('../i18n.svelte', () => ({
  t: (text: string) => text,
  key: (text: string) => text,
}))

const chosen = vi.hoisted(() => ({ model: '' }))

vi.mock('../modes.svelte', () => ({
  modes: {
    get glassesModel() {
      return chosen.model
    },
    setGlassesModel: (model: string) => {
      chosen.model = model
    },
  },
}))

let account: AccountDouble
let glassesKey: typeof import('./key.svelte').glassesKey
let Offered: typeof import('./offered.svelte').Offered

beforeEach(async () => {
  server.set = false
  server.tail = ''
  server.refuse = ''
  server.models = ['gpt-6-astra', 'gpt-5.6-sol']
  server.asked = []
  server.held = null
  chosen.model = ''

  vi.resetModules()
  account = (await import('../account.svelte')).account as unknown as AccountDouble
  account.signInAs('a')
  glassesKey = (await import('./key.svelte')).glassesKey
  Offered = (await import('./offered.svelte')).Offered
})

describe('what this machine knows about the account’s key', () => {
  test('is nothing at all until the account has answered', () => {
    expect(glassesKey.set).toBe(false)
    expect(glassesKey.tail).toBe('')
  })

  test('is whether there is one and its last four characters, and never more', () => {
    glassesKey.took({ set: true, tail: '4f2a' })

    expect(glassesKey.set).toBe(true)
    expect(glassesKey.tail).toBe('4f2a')
    expect(Object.values(glassesKey).join(' ')).not.toContain('sk-')
  })

  test('stays as it was when the account answered nothing', () => {
    glassesKey.took({ set: true, tail: '4f2a' })
    glassesKey.took(undefined)
    expect(glassesKey.tail).toBe('4f2a')
  })
})

describe('setting a key', () => {
  test('sends it once and keeps only what came back', async () => {
    expect(await glassesKey.put('sk-proj-example-4f2a')).toBe('')

    expect(server.asked).toEqual(['put sk-proj-example-4f2a'])
    expect(glassesKey.set).toBe(true)
    expect(glassesKey.tail).toBe('4f2a')
  })

  test('trims what was pasted, because a key off a web page brings a newline', async () => {
    await glassesKey.put('  sk-proj-example-9999\n')
    expect(server.asked).toEqual(['put sk-proj-example-9999'])
  })

  test('answers what the server refused with, and changes nothing', async () => {
    server.refuse = 'this server cannot keep a key yet'
    expect(await glassesKey.put('sk-proj-example-4f2a')).toBe('this server cannot keep a key yet')
    expect(glassesKey.set).toBe(false)
  })

  test('asks for nothing at all with no account behind the machine', async () => {
    account.signOut()
    expect(await glassesKey.put('sk-proj-example-4f2a')).toBe('sign in first')
    expect(server.asked).toEqual([])
  })

  test('replaces on a second write, because there is no editing what cannot be read', async () => {
    await glassesKey.put('sk-proj-example-4f2a')
    await glassesKey.put('sk-proj-another-9999')

    expect(glassesKey.tail).toBe('9999')
    expect(server.asked).toEqual(['put sk-proj-example-4f2a', 'put sk-proj-another-9999'])
  })

  test('takes it away, and says so', async () => {
    await glassesKey.put('sk-proj-example-4f2a')
    await glassesKey.remove()

    expect(glassesKey.set).toBe(false)
    expect(glassesKey.tail).toBe('')
  })

  test('leaves the field saying "set" where taking it away was refused', async () => {
    await glassesKey.put('sk-proj-example-4f2a')
    server.refuse = 'no'
    await glassesKey.remove()

    expect(glassesKey.set).toBe(true)
  })
})

describe('the line under the field', () => {
  test('says nothing before a key is typed', () => {
    const offered = new Offered()
    expect(offered.said).toBe('')
    expect(offered.models).toEqual([])
  })

  test('asks for the models the moment a key goes in, and then says nothing', async () => {
    const offered = new Offered()
    await offered.take('sk-proj-example-4f2a')

    expect(server.asked).toEqual(['put sk-proj-example-4f2a', 'models'])
    expect(offered.models).toEqual(['gpt-6-astra', 'gpt-5.6-sol'])
    expect(offered.said).toBe('')
    expect(chosen.model).toBe('gpt-6-astra')
  })

  test('says why where the key was refused, and offers no models', async () => {
    server.refuse = 'that does not look like a key'
    const offered = new Offered()
    await offered.take('nonsense')

    expect(offered.said).toBe('that does not look like a key')
    expect(offered.models).toEqual([])
    expect(server.asked).toEqual(['put nonsense'])
  })

  test('says so where the key can use nothing Orden asks for', async () => {
    server.models = []
    const offered = new Offered()
    await offered.take('sk-proj-example-4f2a')

    expect(offered.said).toBe('That key cannot use any of the models Orden asks for.')
  })

  test('sends nothing at all for an empty field', async () => {
    const offered = new Offered()
    await offered.take('   ')

    expect(server.asked).toEqual([])
    expect(offered.said).toBe('')
  })

  test('asks at once when the pane is opened with a key already set', async () => {
    glassesKey.took({ set: true, tail: '4f2a' })
    new Offered()
    await Promise.resolve()

    expect(server.asked).toEqual(['models'])
  })

  test('drops the models with the key, because they were that key’s', async () => {
    const offered = new Offered()
    await offered.take('sk-proj-example-4f2a')
    await offered.remove()

    expect(glassesKey.set).toBe(false)
    expect(offered.models).toEqual([])
    expect(offered.said).toBe('')
  })
})

function hold(): () => void {
  let free: () => void = () => undefined
  server.held = new Promise((resolve) => (free = resolve))
  return free
}

describe('another account signing in', () => {
  test('finds no key of the last account’s said to be set', () => {
    glassesKey.took({ set: true, tail: '4f2a' })
    account.signInAs('b')

    expect(glassesKey.set).toBe(false)
    expect(glassesKey.tail).toBe('')
  })

  test('never takes the models the last account asked for as its own', async () => {
    glassesKey.took({ set: true, tail: '4f2a' })
    const free = hold()
    const offered = new Offered()

    account.signInAs('b')
    free()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(server.asked).toEqual(['models'])
    expect(chosen.model).toBe('')
    expect(offered.models).toEqual([])
  })

  test('never wears the key the last account was saving', async () => {
    const free = hold()
    const putting = glassesKey.put('sk-proj-example-4f2a')

    account.signInAs('b')
    free()
    await putting

    expect(glassesKey.set).toBe(false)
  })
})
