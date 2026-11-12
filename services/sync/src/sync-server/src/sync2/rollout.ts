import { now } from '../crypto'
import type { Env } from '../types'
import { accountBy, minimum, move, NEEDS_MIN, standing } from './gate'

export type Mode = 'off' | 'new' | 'all'

const MODES: readonly Mode[] = ['off', 'new', 'all']

export function isMode(value: unknown): value is Mode {
  return MODES.includes(value as Mode)
}

export interface Rollout {
  mode: Mode
  min: string | null
  since: number
}

async function rolloutOf(env: Env): Promise<Rollout> {
  const { results } = await env.DB.prepare('select key, value from sync_rollout').all<{
    key: string
    value: string
  }>()
  const said = new Map(results.map((one) => [one.key, one.value]))
  const mode = said.get('mode')
  const min = said.get('min') ?? null
  const since = Number(said.get('since'))
  return {
    mode: isMode(mode) ? mode : 'off',
    min: min && 'min' in minimum(min) ? min : null,
    since: Number.isFinite(since) ? since : 0,
  }
}

function setting(env: Env, key: 'mode' | 'min' | 'since', value: string) {
  return env.DB.prepare(
    `insert into sync_rollout (key, value) values (?1, ?2)
     on conflict(key) do update set value = ?2`,
  ).bind(key, value)
}

export async function setRollout(
  env: Env,
  mode: Mode,
  given: string | undefined,
): Promise<{ rollout: Rollout } | { error: string }> {
  let min: string | null = null
  if (given !== undefined) {
    const judged = minimum(given)
    if ('error' in judged) return { error: judged.error }
    min = judged.min
  }
  if (mode === 'all' && min === null && (await rolloutOf(env)).min === null) {
    return { error: NEEDS_MIN }
  }

  await env.DB.batch([
    setting(env, 'mode', mode),
    setting(env, 'since', String(now())),
    ...(min === null ? [] : [setting(env, 'min', min)]),
  ])
  return { rollout: await rolloutOf(env) }
}

export async function startingVersion(env: Env): Promise<1 | 2> {
  return (await rolloutOf(env)).mode === 'off' ? 1 : 2
}

async function heldBack(env: Env, user: string, since: number): Promise<boolean> {
  const last = await env.DB.prepare(
    `select to_version from sync_flips where user_id = ? and at >= ?
      order by at desc, rowid desc limit 1`,
  )
    .bind(user, since)
    .first<{ to_version: number }>()
  return last?.to_version === 1
}

export async function rollOn(env: Env, user: string): Promise<boolean> {
  const rollout = await rolloutOf(env)
  if (rollout.mode !== 'all' || rollout.min === null) return false

  const account = await accountBy(env, 'id', user)
  if (!account || account.version === 2) return false
  if (await heldBack(env, user, rollout.since)) return false

  const { blockers } = await standing(env, account, {
    min: rollout.min,
    allow: new Set(),
    asker: null,
    deviceless: 'pass',
  })
  if (blockers.length > 0) return false
  return await move(env, account, 2, 'hello', rollout.min)
}

export async function everyoneBack(env: Env, dry: boolean): Promise<number> {
  if (dry) {
    const counted = await env.DB.prepare(
      'select count(*) as n from users where sync_version = 2',
    ).first<{ n: number }>()
    return counted?.n ?? 0
  }

  const at = now()
  const [, , , moved] = await env.DB.batch([
    setting(env, 'mode', 'off'),
    setting(env, 'since', String(at)),
    env.DB.prepare(
      `insert into sync_flips (user_id, at, from_version, to_version, why, min)
       select id, ?, 2, 1, 'everyone', null from users where sync_version = 2`,
    ).bind(at),
    env.DB.prepare('update users set sync_version = 1 where sync_version = 2'),
  ])
  const count = (moved as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0
  console.warn(`[sync-version] everyone 2 -> 1: ${count} accounts, rollout off`)
  return count
}

export async function rolloutView(env: Env) {
  const rollout = await rolloutOf(env)
  const { results: counts } = await env.DB.prepare(
    'select sync_version as version, count(*) as n from users group by sync_version',
  ).all<{ version: number; n: number }>()
  const on = (two: boolean) =>
    counts.filter((one) => (one.version === 2) === two).reduce((sum, one) => sum + one.n, 0)
  const { results: moves } = await env.DB.prepare(
    `select u.email as email, f.at as at, f.from_version as "from", f.to_version as "to",
            f.why as why, f.min as min
       from sync_flips f join users u on u.id = f.user_id
      order by f.at desc, f.rowid desc limit 50`,
  ).all()
  return {
    ...rollout,
    accounts: { v1: on(false), v2: on(true) },
    moves,
  }
}
