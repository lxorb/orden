import { afterEach, describe, expect, test, vi } from 'vitest'
import { accountServer } from './server'

afterEach(() => vi.unstubAllGlobals())

function answering(status: number, body: string, type = 'text/html') {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': type } })),
  )
}

const CHANGE = [{ kind: 'span', id: 'a', value: { start: 1 } }]

describe('an account that keeps no time records yet', () => {
  test('is heard in the app’s own page answering in place of the route', async () => {
    answering(200, '<!doctype html><title>Orden</title>')
    const server = accountServer('token')
    expect(await server.pull(0)).toBeNull()
    expect(await server.push(CHANGE)).toBe(false)
  })

  test('is heard in a route that is not there', async () => {
    answering(404, 'Not found', 'text/plain')
    const server = accountServer('token')
    expect(await server.pull(0)).toBeNull()
    expect(await server.push(CHANGE)).toBe(false)
  })

  test('is not a server that failed, which is tried again later', async () => {
    answering(503, '{"error":"busy"}', 'application/json')
    const server = accountServer('token')
    await expect(server.pull(0)).rejects.toThrow()
    await expect(server.push(CHANGE)).rejects.toThrow()
  })

  test('is not one that keeps them', async () => {
    answering(200, '{"cursor":3}', 'application/json')
    expect(await accountServer('token').push(CHANGE)).toBe(true)
  })
})
