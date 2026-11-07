import { describe, expect, test } from 'vitest'
import { fetchCall, NoPass, PassApi, Refused } from './sync'

interface Seen {
  url: string
  method: string
  auth: string | null
  body: unknown
}

function fake(answer: (seen: Seen) => { status: number; body: unknown } | string) {
  const seen: Seen[] = []
  const fetcher = async (request: Request): Promise<Response> => {
    const text = await request.text()
    const one: Seen = {
      url: request.url,
      method: request.method,
      auth: request.headers.get('authorization'),
      body: text ? JSON.parse(text) : null,
    }
    seen.push(one)
    const said = answer(one)
    if (typeof said === 'string') return new Response(said, { status: 404 })
    return new Response(JSON.stringify(said.body), { status: said.status })
  }
  return {
    seen,
    api: new PassApi(fetchCall(fetcher, 'https://orden.test', 'tok'), () => 'device-1'),
  }
}

const changes = { seq: 4, more: false, keyring: null, vaults: [], items: [], invites: [] }

describe('the Pass API on the device', () => {
  test('reads the changes under /v2/pass with the token', async () => {
    const { seen, api } = fake(() => ({ status: 200, body: changes }))
    expect(await api.changes(3)).toEqual(changes)
    expect(seen[0]).toMatchObject({
      url: 'https://orden.test/v2/pass/changes?since=3',
      method: 'GET',
      auth: 'Bearer tok',
    })
  })

  test('names this device on every write so its own hub stays quiet', async () => {
    const { seen, api } = fake(() => ({ status: 200, body: { rev: 2, at: 7 } }))
    const sent = { rev: 1, key: 'a2V5', body: 'Ym9keQ==', keyVersion: 1 }
    expect(await api.putItem('vault-01', 'item-001', sent)).toEqual({
      ok: true,
      value: { rev: 2, at: 7 },
    })
    await api.deleteItem('vault-01', 'item-001', 2)
    expect(seen.map((one) => `${one.method} ${one.url}`)).toEqual([
      'PUT https://orden.test/v2/pass/items/vault-01/item-001?from=device-1',
      'DELETE https://orden.test/v2/pass/items/vault-01/item-001?rev=2&from=device-1',
    ])
    expect(seen[0]?.body).toEqual(sent)
  })

  test('hands back a refusal with what the account holds now', async () => {
    const current = { vault: 'v', id: 'i', rev: 3 }
    const { api } = fake(() => ({ status: 409, body: { error: 'stale', current } }))
    expect(
      await api.putItem('vault-01', 'item-001', { rev: 1, key: 'a', body: 'b', keyVersion: 1 }),
    ).toEqual({ ok: false, status: 409, error: 'stale', current, keyVersion: null })
  })

  test('hands back the newer key version', async () => {
    const { api } = fake(() => ({
      status: 409,
      body: { error: 'the vault has a newer key', keyVersion: 2 },
    }))
    const answer = await api.putItem('v', 'i', { rev: 1, key: 'a', body: 'b', keyVersion: 1 })
    expect(answer).toMatchObject({ ok: false, error: 'the vault has a newer key', keyVersion: 2 })
  })

  test('takes a deleted vault as landed', async () => {
    const { api } = fake(() => ({ status: 200, body: { ok: true } }))
    expect((await api.deleteVault('vault-01')).ok).toBe(true)
  })

  test('knows an account without Pass by its bare not found', async () => {
    const { api } = fake(() => '404 Not Found')
    await expect(api.changes(0)).rejects.toBeInstanceOf(NoPass)
    await expect(api.putKeyring({} as never, 0)).rejects.toBeInstanceOf(NoPass)
  })

  test('tells a missing vault from an account without Pass', async () => {
    const { api } = fake(() => ({ status: 404, body: { error: 'no such vault' } }))
    expect(
      await api.putItem('v', 'i', { rev: 1, key: 'a', body: 'b', keyVersion: 1 }),
    ).toMatchObject({ ok: false, status: 404, error: 'no such vault' })
  })

  test('throws when the server fails, so nothing is marked sent', async () => {
    const { api } = fake(() => ({ status: 503, body: { error: 'down' } }))
    await expect(
      api.putItem('v', 'i', { rev: 1, key: 'a', body: 'b', keyVersion: 1 }),
    ).rejects.toBeInstanceOf(Refused)
  })

  test('refuses changes it cannot read', async () => {
    const { api } = fake(() => ({ status: 200, body: { seq: 'x' } }))
    await expect(api.changes(0)).rejects.toThrow('unreadable')
  })

  test('reads a vault’s items page by page', async () => {
    const row = (id: string) => ({
      vault: 'vault-01',
      id,
      rev: 1,
      key: 'a2V5',
      body: 'Ym9keQ==',
      keyVersion: 1,
      at: 1,
      deleted: false,
    })
    const { seen, api } = fake((one) =>
      one.url.endsWith('after=')
        ? { status: 200, body: { items: [row('item-0001')], more: true } }
        : { status: 200, body: { items: [row('item-0002')], more: false } },
    )
    expect((await api.allVaultItems('vault-01')).map((one) => one.id)).toEqual([
      'item-0001',
      'item-0002',
    ])
    expect(seen[1]?.url).toBe('https://orden.test/v2/pass/vaults/vault-01/items?after=item-0001')
  })
})
