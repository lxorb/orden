import type { Env } from '../../../sync-server/src/api'

export interface Service {
  on: boolean
  ceiling: number
  admin: string | null
}

const DEFAULT_CEILING = 30

export async function serviceOf(env: Env): Promise<Service> {
  const { results } = await env.DB.prepare('select key, value from online_service').all<{
    key: string
    value: string
  }>()
  const said = new Map(results.map((one) => [one.key, one.value]))
  const ceiling = Number(said.get('ceiling'))

  return {
    on: said.get('online') === 'on' && env.MACHINES !== undefined,
    ceiling: Number.isFinite(ceiling) && ceiling >= 0 ? ceiling : DEFAULT_CEILING,
    admin: said.get('admin')?.trim() ? (said.get('admin') ?? null) : null,
  }
}

export async function setService(env: Env, key: 'online' | 'ceiling', value: string) {
  await env.DB.prepare(
    `insert into online_service (key, value) values (?1, ?2)
     on conflict(key) do update set value = ?2`,
  )
    .bind(key, value)
    .run()
}

export async function allowed(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare('select online from users where id = ?')
    .bind(userId)
    .first<{ online: number }>()
  return row?.online === 1
}
