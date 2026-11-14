import { beforeEach, describe, expect, test, vi } from 'vitest'

const server = vi.hoisted(() => ({
  refuse: false,
  refuseDelete: false,
  clients: [] as { id: string; name: string }[],
  asked: [] as string[],
}))

const no = () => Promise.reject(new Error('the service said no'))

vi.mock('./accounts/src/client', () => ({
  api: {
    connector: () => {
      server.asked.push('connector')
      if (server.refuse) return no()

      return Promise.resolve({
        exists: true,
        readOnly: true,
        lastUsedAt: null,
        clients: server.clients.map((one) => ({
          ...one,
          readOnly: true,
          createdAt: 0,
          lastUsedAt: null,
        })),
      })
    },
    disconnectClient: (_token: string, id: string) => {
      server.asked.push(`disconnect ${id}`)
      if (server.refuse || server.refuseDelete) return no()

      server.clients = server.clients.filter((one) => one.id !== id)
      return Promise.resolve({ ok: true as const })
    },
    issueConnector: () => {
      server.asked.push('issue')
      return server.refuse ? no() : Promise.resolve({ token: 'mcp-secret' })
    },
    revokeConnector: () => {
      server.asked.push('revoke')
      return server.refuse ? no() : Promise.resolve({ ok: true as const })
    },
  },
}))

vi.mock('./accounts/src/account.svelte', () => ({
  account: { accountToken: 'session', forgetWithSession: () => undefined },
}))

vi.mock('./ui-kit/src/message', () => ({
  message: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

let connectors: typeof import('./connectors.svelte').connectors

await import('./connectors.svelte')

beforeEach(async () => {
  localStorage.clear()
  server.refuse = false
  server.refuseDelete = false
  server.clients = [{ id: 'c1', name: 'Claude' }]
  server.asked = []

  vi.resetModules()
  ;({ connectors } = await import('./connectors.svelte'))
})

describe('taking a client off the account', () => {
  test('goes at once and stays gone', async () => {
    await connectors.load()
    await connectors.disconnect('c1')

    expect(server.asked).toContain('disconnect c1')
    expect(connectors.clients).toEqual([])
  })

  test('says why when the service refuses, and puts the row back', async () => {
    await connectors.load()
    server.refuseDelete = true

    await connectors.disconnect('c1')

    expect(connectors.error).toBe('the service said no')
    expect(connectors.clients.map((one) => one.id)).toEqual(['c1'])
  })
})

describe('the pasted token', () => {
  test('is shown once, straight after minting', async () => {
    await connectors.createToken()
    expect(connectors.freshToken).toBe('mcp-secret')
  })

  test('says why a mint did not happen', async () => {
    server.refuse = true
    await connectors.createToken()

    expect(connectors.freshToken).toBeNull()
    expect(connectors.error).toBe('the service said no')
  })

  test('says why a revoke did not happen, and keeps showing the token', async () => {
    await connectors.createToken()
    server.refuse = true

    await connectors.revokeToken()

    expect(connectors.error).toBe('the service said no')
    expect(connectors.freshToken).toBe('mcp-secret')
    expect(connectors.busy).toBe(false)
  })
})
