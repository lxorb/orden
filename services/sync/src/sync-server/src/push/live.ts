import type { Env } from '../types'

export function liveTarget(at: string): string {
  return `exists (select 1 from sessions s
                   where s.token_hash = t.session_hash and s.expires_at > ${at})`
}

export async function forgetEndedTargets(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `delete from push_targets
      where user_id = ?1
        and not exists (select 1 from sessions s
                         where s.token_hash = push_targets.session_hash and s.expires_at > ?2)`,
  )
    .bind(userId, Date.now())
    .run()
}
