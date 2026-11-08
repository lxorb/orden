import { describe, expect, test, vi } from 'vitest'
import { ApiError } from '../api'
import { eachDue, reachable, sentAll } from './rounds'
import { Refused } from './transport'

describe('eachDue', () => {
  test('a space that throws leaves the others their turn, and is said after', async () => {
    const ran: string[] = []
    const due = new Set(['a', 'b', 'c'])
    await expect(
      eachDue(
        due,
        () => true,
        (id) => {
          ran.push(id)
          return id === 'a' ? Promise.reject(new Error('a stopped')) : Promise.resolve()
        },
      ),
    ).rejects.toThrow('a stopped')
    expect(ran).toEqual(['a', 'b', 'c'])
    expect(due.size).toBe(0)
  })

  test('a session that ended stops at once', async () => {
    const ran: string[] = []
    const due = new Set(['a', 'b'])
    await expect(
      eachDue(
        due,
        () => true,
        (id) => {
          ran.push(id)
          return Promise.reject(new Refused(401, 'signed out'))
        },
      ),
    ).rejects.toMatchObject({ status: 401 })
    expect(ran).toEqual(['a'])
    expect([...due]).toEqual(['b'])
  })
})

describe('the way back to v1', () => {
  const sending = (refusing: string) => ({
    pass: vi.fn((id: string) =>
      id === refusing
        ? Promise.reject(new Refused(403, 'not yours'))
        : Promise.resolve({ finished: true }),
    ),
    waiting: () => false,
  })

  test('a space the account refuses does not hold up the others', async () => {
    const engine = sending('lost')
    expect(await sentAll(engine, new Set(['lost', 'kept']), 4, () => Promise.resolve())).toBe(true)
    expect(engine.pass).toHaveBeenCalledWith('kept')
  })

  test('another trouble still waits', async () => {
    const engine = {
      pass: () => Promise.reject(new Error('the disk')),
      waiting: () => false,
    }
    await expect(sentAll(engine, new Set(['one']), 4, () => Promise.resolve())).rejects.toThrow(
      'the disk',
    )
    const away = { pass: () => Promise.resolve(null), waiting: () => false }
    expect(await sentAll(away, new Set(['one']), 4, () => Promise.resolve())).toBe(false)
  })

  const refused = (status: number) =>
    Promise.reject(new ApiError(status, 'no', { error: 'no such space' }))

  test('gone is a refused listing and a list of spaces without it', async () => {
    const { listings, gone } = await reachable(
      new Set(['lost', 'erased', 'kept']),
      (id) => (id === 'kept' ? Promise.resolve(1) : refused(id === 'lost' ? 403 : 404)),
      () => Promise.resolve(['kept']),
    )
    expect([...listings.keys()]).toEqual(['kept'])
    expect([...gone]).toEqual(['lost', 'erased'])
  })

  test('a stray 403 on a space the account still lists takes nothing away', async () => {
    const { listings, gone } = await reachable(
      new Set(['one']),
      () => refused(403),
      () => Promise.resolve(['one']),
    )
    expect(listings.size).toBe(0)
    expect(gone.size).toBe(0)
  })

  test('a list that does not answer either says nothing, and an account out of reach waits', async () => {
    await expect(
      reachable(
        new Set(['one']),
        () => refused(403),
        () => refused(403),
      ),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      reachable(
        new Set(['one']),
        () => refused(503),
        () => Promise.resolve([]),
      ),
    ).rejects.toMatchObject({ status: 503 })
  })

  test('a refusal from something in the way is no answer from the account, and waits', async () => {
    const blocked = {
      pass: () => Promise.reject(new Refused(403, 'request failed (403)', false)),
      waiting: () => false,
    }
    await expect(
      sentAll(blocked, new Set(['one']), 4, () => Promise.resolve()),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      reachable(
        new Set(['one']),
        () => Promise.reject(new ApiError(404, 'Not Found', '<html>not here</html>')),
        () => Promise.resolve([]),
      ),
    ).rejects.toMatchObject({ status: 404 })
  })
})
