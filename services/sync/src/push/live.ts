/** Which push targets may still be sent to: those whose registering session is still
 *  signed in (0054).
 *
 *  A target outlives nothing it was registered through. Ending a device, ending its
 *  session, signing it out and a session simply running out all end the session, and
 *  each is the same answer here, asked at the moment something would be sent rather
 *  than remembered at each of the places a session ends. Those places also take the
 *  rows away (`forgetEndedTargets`), so nothing is kept that is never sent. */

import type { Env } from '../types'

/** The condition, on a target aliased `t`, with the moment bound at `at` (`?2`, say).
 *  Written once so every reader of the table asks the same question. */
export function liveTarget(at: string): string {
  return `exists (select 1 from sessions s
                   where s.token_hash = t.session_hash and s.expires_at > ${at})`
}

/** Every target of the account whose session has ended, taken away. */
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
