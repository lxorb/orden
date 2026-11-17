import type { Env } from './types'

export async function accountAddress(env: Env, email: string): Promise<string> {
  const held = await env.DB.prepare(
    'select u.email from user_addresses a join users u on u.id = a.user_id where a.email = ?',
  )
    .bind(email)
    .first<{ email: string }>()
  return held?.email ?? email
}

export function movedAddress(env: Env, from: string, to: string): D1PreparedStatement[] {
  return ['space_members', 'space_requests', 'pass_members'].flatMap((table) => [
    env.DB.prepare(`update or ignore ${table} set email = ?2 where email = ?1`).bind(from, to),
    env.DB.prepare(`delete from ${table} where email = ?1`).bind(from),
  ])
}
