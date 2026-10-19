import type { Env } from './types'

/** What one account may keep, notes and images together. */
export const QUOTA = 1024 * 1024 * 1024

/** What an account's notes and its blobs come to, as SQL around the parameter that
 *  names it: for `usedBytes`, and for a write that may only land under the quota. */
const NOTES_USED = (user: string) => `(select coalesce(sum(n.size), 0)
          from notes n join spaces s on s.id = n.space_id
         where s.user_id = ${user} and n.kind != 'file')`
const BLOBS_USED = (user: string) =>
  `(select coalesce(sum(size), 0) from blobs where user_id = ${user})`

/** Whether `incoming` more bytes fit the account named by the parameter `user`, as a
 *  condition a statement can carry: checked by the write itself, so two writes that
 *  each fit on their own cannot both land past the quota. */
export function fitsSql(user: string, incoming: string): string {
  return `${NOTES_USED(user)} + ${BLOBS_USED(user)} + ${incoming} <= ${String(QUOTA)}`
}

/** Bytes an account is using: every note it can reach plus every image it is
 *  keeping.
 *
 *  A note in Recently deleted counts. Its bytes are still in the bucket - that is
 *  what being able to put it back means - and leaving them out was a way round the
 *  whole limit: fill the account, delete the lot, fill it again, and the fourteen
 *  days each round waits for are fourteen days of storage nobody was charged for.
 *  What is purged costs nothing because purging sets the size to zero and takes
 *  the row of a purged space away; see `purgeNote` and `purgeSpace` in trash.ts.
 *  So the sum over every row is exactly what the bucket holds. */
export async function usedBytes(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `select ${NOTES_USED('?1')} as notes, ${BLOBS_USED('?1')} as blobs`,
  )
    .bind(userId)
    .first<{ notes: number; blobs: number }>()

  return (row?.notes ?? 0) + (row?.blobs ?? 0)
}

/** Whether `incoming` more bytes would fit, given that `replacing` bytes of
 *  what is already counted are about to be given back. */
export async function fits(
  env: Env,
  userId: string,
  incoming: number,
  replacing = 0,
): Promise<boolean> {
  const used = await usedBytes(env, userId)
  return used - replacing + incoming <= QUOTA
}
