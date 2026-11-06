import type { Env } from './types'

export const QUOTA = 1024 * 1024 * 1024

const NOTES_USED = (user: string) => `(select coalesce(sum(n.size), 0)
          from notes n join spaces s on s.id = n.space_id
         where s.user_id = ${user} and n.kind != 'file')`
const BLOBS_USED = (user: string) =>
  `(select coalesce(sum(size), 0) from blobs where user_id = ${user})`

export function fitsSql(user: string, incoming: string): string {
  return `${NOTES_USED(user)} + ${BLOBS_USED(user)} + ${incoming} <= ${String(QUOTA)}`
}

export async function usedBytes(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `select ${NOTES_USED('?1')} as notes, ${BLOBS_USED('?1')} as blobs`,
  )
    .bind(userId)
    .first<{ notes: number; blobs: number }>()

  return (row?.notes ?? 0) + (row?.blobs ?? 0)
}

export async function fits(
  env: Env,
  userId: string,
  incoming: number,
  replacing = 0,
): Promise<boolean> {
  const used = await usedBytes(env, userId)
  return used - replacing + incoming <= QUOTA
}
