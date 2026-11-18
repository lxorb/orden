import type { Env } from './types'

export async function accountAddress(env: Env, email: string): Promise<string> {
  const held = await env.DB.prepare(
    'select u.email from user_addresses a join users u on u.id = a.user_id where a.email = ?',
  )
    .bind(email)
    .first<{ email: string }>()
  return held?.email ?? email
}

const SAME = {
  space_members: 'o.space_id = t.space_id and o.item = t.item',
  space_requests: 'o.space_id = t.space_id and o.item = t.item',
  pass_members: 'o.vault_id = t.vault_id',
} as const

const RANK = {
  space_members: (row: string) => `(${row}.role = 'write') * 2 + (${row}.joined_at is not null)`,
  space_requests: (row: string) => `(${row}.role = 'write')`,
  pass_members: (row: string) =>
    `case ${row}.state when 'active' then 30 when 'confirm' then 20 when 'pending' then 10 else 0 end + case ${row}.role when 'owner' then 3 when 'manager' then 2 when 'editor' then 1 else 0 end`,
} as const

export function movedAddress(env: Env, from: string, to: string): D1PreparedStatement[] {
  return (['space_members', 'space_requests', 'pass_members'] as const).flatMap((table) => [
    env.DB.prepare(
      `delete from ${table} as t where t.email = ?2 and exists (select 1 from ${table} o where o.email = ?1 and ${SAME[table]} and ${RANK[table]('o')} > ${RANK[table]('t')})`,
    ).bind(from, to),
    env.DB.prepare(`update or ignore ${table} set email = ?2 where email = ?1`).bind(from, to),
    env.DB.prepare(`delete from ${table} where email = ?1`).bind(from),
  ])
}
