import type { Context } from 'hono'
import { note } from '../failed'
import type { Env } from '../types'
import { tellHubs } from './reach'

const REACHING = `select user_id as id from spaces where id = ?1
  union select u.id from space_members m join users u on u.email = m.email where m.space_id = ?1
  union select guest_id from guest_members where space_id = ?1 and joined_at is not null`

type Later = Pick<ExecutionContext, 'waitUntil'>

export function pokeSpace(
  env: Env,
  later: Later,
  spaceId: string,
  seq: number,
  from?: string,
): Promise<void> {
  if (env.HUB) later.waitUntil(poking(env, spaceId, seq, from ?? ''))
  return Promise.resolve()
}

export async function pokeNow(
  env: Env,
  spaceId: string,
  seq: number,
  from?: string,
): Promise<void> {
  if (env.HUB) await poking(env, spaceId, seq, from ?? '')
}

export function laterOf(context: Context): Later {
  try {
    return context.executionCtx
  } catch {
    return { waitUntil: (work) => void work }
  }
}

async function poking(env: Env, spaceId: string, seq: number, from: string): Promise<void> {
  try {
    const { results } = await env.DB.prepare(REACHING).bind(spaceId).all<{ id: string }>()
    await tellHubs(
      env,
      results.map((one) => one.id),
      'poke',
      { 'x-orden-space': spaceId, 'x-orden-seq': String(seq), 'x-orden-from': from },
    )
  } catch (error) {
    note(`poke ${spaceId}`, error, null)
  }
}
