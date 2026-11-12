import type { Env } from './types'

export const ASK_SIGNINS_EVERY = 60_000

const SIGNED_IN = `select value as login from json_each(?1)
  where exists (select 1 from sessions s where s.token_hash = value and s.expires_at > ?2)
     or exists (select 1 from guest_sessions g where g.token_hash = value and g.expires_at > ?2)`

export { SIGNED_OUT } from '@orden/sync-core'

export async function stillSignedIn(env: Env, logins: readonly string[]): Promise<Set<string>> {
  if (!logins.length) return new Set()
  const { results } = await env.DB.prepare(SIGNED_IN)
    .bind(JSON.stringify([...new Set(logins)]), Date.now())
    .all<{ login: string }>()
  return new Set(results.map((row) => row.login))
}
