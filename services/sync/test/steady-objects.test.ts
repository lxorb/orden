import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { AccountHub, AppRelay, ChatLog, NoteRoom } from '../src'
import { Machine } from '../src/sync-server-machines/src/machines/machine'
import type { Env } from '../src/sync-server/src/types'
import { HubState } from './hub-fakes'

const WRANGLER = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))

const state = () => new HubState() as unknown as DurableObjectState

const MADE: Record<string, (env: Env) => object> = {
  NoteRoom: (env) => new NoteRoom(state(), env),
  AccountHub: (env) => new AccountHub(state(), env),
  ChatLog: (env) => new ChatLog(state(), env),
  AppRelay: (env) => new AppRelay(state(), env),
  Machine: (env) => new Machine(state(), env),
}

function busyOnce(): { db: D1Database; asked: () => number } {
  let asked = 0
  const statement = {
    bind: () => statement,
    first: () => {
      asked += 1
      return asked === 1
        ? Promise.reject(new Error('D1_ERROR: database is locked: SQLITE_BUSY'))
        : Promise.resolve({ one: 1 })
    },
  }
  return { db: { prepare: () => statement } as unknown as D1Database, asked: () => asked }
}

test('every durable object asks the database again while it is busy, as a request does', async () => {
  const named = new Set(
    [...readFileSync(WRANGLER, 'utf8').matchAll(/"class_name":\s*"(\w+)"/g)].map((one) => one[1]),
  )
  expect(named.size).toBeGreaterThan(0)

  for (const name of named) {
    const make = name === undefined ? undefined : MADE[name]
    expect(make, `${String(name)} is not built here`).toBeDefined()
    const busy = busyOnce()
    const made = make?.({ DB: busy.db } as Env)
    const held = Reflect.get(made ?? {}, 'env') as Env
    expect(await held.DB.prepare('select 1 as one').bind().first(), String(name)).toEqual({
      one: 1,
    })
    expect(busy.asked(), String(name)).toBe(2)
  }
})
