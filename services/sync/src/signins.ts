/** Whether the sign-ins sockets arrived with are still signed in.
 *
 *  A socket is let in by a door that checks its session once, at the handshake, and a
 *  socket is not a request: nothing after that asks again. Ending a session, signing
 *  out and ending a device say so to the objects that hold the person's sockets, but a
 *  session that simply runs out says nothing to anybody. So each object that holds
 *  sockets - a room, a chat, a machine - keeps the hash of the sign-in each socket
 *  arrived with, and asks this about them from time to time, closing what has ended
 *  (#455, #520). An account's sign-in or a guest's, as the doors read them. */

import type { Env } from './types'

/** How often an object asks: at most once a minute. */
export const ASK_SIGNINS_EVERY = 60_000

/** The question, with the hashes as JSON in `?1` and now in `?2`. */
export const SIGNED_IN = `select value as login from json_each(?1)
  where exists (select 1 from sessions s where s.token_hash = value and s.expires_at > ?2)
     or exists (select 1 from guest_sessions g where g.token_hash = value and g.expires_at > ?2)`

/** What a socket that outlived its sign-in is closed with. */
export const SIGNED_OUT = 4401

/** Which of these sign-ins still live. */
export async function stillSignedIn(env: Env, logins: readonly string[]): Promise<Set<string>> {
  if (!logins.length) return new Set()
  const { results } = await env.DB.prepare(SIGNED_IN)
    .bind(JSON.stringify([...new Set(logins)]), Date.now())
    .all<{ login: string }>()
  return new Set(results.map((row) => row.login))
}
