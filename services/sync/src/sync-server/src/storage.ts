import type { Env } from './types'

export const QUOTA = 1024 * 1024 * 1024

const NOTES_USED = (user: string) => `(select coalesce(sum(n.size), 0)
          from notes n join spaces s on s.id = n.space_id
         where s.user_id = ${user} and n.kind != 'file')`
const BLOBS_USED = (user: string) =>
  `(select coalesce(sum(size), 0) from blobs where user_id = ${user})`
const PASS_USED = (user: string) =>
  `(select coalesce(sum(size), 0) from pass_file_parts where user_id = ${user})`
const PASS_ROWS_USED = (rows: string, user: string) =>
  `(select coalesce(sum(length(r.body) + length(r.key)), 0) from ${rows} r
     join pass_vaults v on v.id = r.vault_id where v.owner_id = ${user})`
const PASS_ITEMS_USED = (user: string) =>
  `${PASS_ROWS_USED('pass_items', user)} + ${PASS_ROWS_USED('pass_versions', user)}`

export function fitsSql(user: string, incoming: string): string {
  return `${NOTES_USED(user)} + ${BLOBS_USED(user)} + ${PASS_USED(user)} + ${PASS_ITEMS_USED(user)} + ${incoming} <= ${String(QUOTA)}`
}

export async function usedBytes(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `select ${NOTES_USED('?1')} as notes, ${BLOBS_USED('?1')} as blobs,
            ${PASS_USED('?1')} + ${PASS_ITEMS_USED('?1')} as pass`,
  )
    .bind(userId)
    .first<{ notes: number; blobs: number; pass: number }>()

  return (row?.notes ?? 0) + (row?.blobs ?? 0) + (row?.pass ?? 0)
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
