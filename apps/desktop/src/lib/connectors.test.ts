import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The connector pane's store: what it does when the service says no.
 *
 *  Every one of these reaches the account over the network, and each is drawn as
 *  a button that does one thing. A refusal that nobody is told about is the
 *  worst of the three outcomes: the row goes away and comes back, or the token
 *  stays alive, and the reader is left to guess which. */

const server = vi.hoisted(() => ({
  /** Set to make every call refuse. */
  refuse: false,
  /** Set to make only the taking-off refuse, so the refresh behind it still
   *  answers - which is the ordinary shape of one being turned down. */
  refuseDelete: false,
  /** The clients the account answers with. */
  clients: [] as { id: string; name: string }[],
  /** What was asked of the service, in order. */
  asked: [] as string[],
}))

const no = () => Promise.reject(new Error('the service said no'))

vi.mock('./api', () => ({
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

// The session is the one thing this store reads from outside itself, and only for
// the token; what happens to a session is account.test.ts's subject.
vi.mock('./account.svelte', () => ({
  account: { accountToken: 'session', forgetWithSession: () => undefined },
}))

vi.mock('./i18n.svelte', () => ({
  t: (text: string) => text,
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

/** The graph, loaded once here rather than by whichever hook runs first; see
 *  docs/conventions.md. */
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

    // The row was taken away optimistically, so a refusal has to undo that as
    // well as explain itself: what the account says is still there is still
    // there.
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

    // Saying nothing here is the worst of it: the pane would read as revoked
    // while the token went on reaching the notes.
    expect(connectors.error).toBe('the service said no')
    expect(connectors.freshToken).toBe('mcp-secret')
    expect(connectors.busy).toBe(false)
  })
})
