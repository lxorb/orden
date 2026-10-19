/** Somebody's access to a space ended or narrowed, and they may be watching one of its
 *  online terminals right now (docs/online-terminal.md, 4.6).
 *
 *  Called from `roomsRevoked`, which every share change already goes through, so a
 *  terminal is closed or downgraded in the same request as a note's room is. Each
 *  machine with a live session in the space is told once, with the files of it that
 *  are in that space; the machine's own owner is never revoked from their own machine.
 *  `Machine`'s minute alarm asks the rows again besides, for anything nothing said. */

import type { Env } from '../types'
import { askMachine } from './ask'

/** How many machines one revocation tells. */
const MOST_MACHINES = 100

export async function machinesRevoked(
  env: Env,
  spaceId: string,
  who: string | null,
  role: 'none' | 'read',
  item = '',
): Promise<void> {
  if (!env.MACHINES || !who) return

  const { results } = await env.DB.prepare(
    `select t.machine as machine, t.user_id as owner, group_concat(t.term) as terms
       from term_sessions t join notes n on n.id = t.term
      where n.space_id = ?1 and t.ended_at is null and (?2 = '' or t.term = ?2)
        and t.user_id <> ?3
      group by t.machine, t.user_id limit ?4`,
  )
    .bind(spaceId, item, who, MOST_MACHINES)
    .all<{ machine: string; owner: string; terms: string }>()

  await Promise.all(
    results.map((one) =>
      askMachine(env, one.machine, 'revoke', {
        'x-nib-user': one.owner,
        'x-nib-who': who,
        'x-nib-role': role,
        'x-nib-terms': one.terms,
      }),
    ),
  )
}

/** How many sign-ins one ending names to a machine: well past how many sessions an
 *  account has, and a bound on the header. Past it the minute alarm finds the rest. */
const MOST_LOGINS = 100

/** Sign-ins of one account that ended - signed out, ended from the sessions or the
 *  devices list - and the terminal sockets that arrived with them, which close now
 *  (`signedOut` in machine.ts), the machine owner's own included.
 *
 *  Unlike a share changing, this is about the person and not about a space: every
 *  machine where they may have a terminal open is told, which is their own and any with a
 *  live session in a space they are in. A machine nothing told closes the socket at its
 *  next minute anyway, when it asks whether each socket's sign-in still lives. */
export async function machinesSignedOut(
  env: Env,
  who: string,
  logins: readonly string[],
): Promise<void> {
  const ended = logins.filter(Boolean).slice(0, MOST_LOGINS)
  if (!env.MACHINES || !who || !ended.length) return

  const { results } = await env.DB.prepare(
    `select distinct t.machine as machine
       from term_sessions t left join notes n on n.id = t.term
      where t.ended_at is null
        and (t.user_id = ?1
             or n.space_id in (select id from spaces where user_id = ?1
                               union select m.space_id from space_members m
                                       join users u on u.email = m.email where u.id = ?1
                               union select g.space_id from guest_members g
                                      where g.guest_id = ?1 and g.joined_at is not null))
      limit ?2`,
  )
    .bind(who, MOST_MACHINES)
    .all<{ machine: string }>()

  await Promise.all(
    results.map((one) =>
      askMachine(env, one.machine, 'signedout', { 'x-nib-logins': ended.join(',') }),
    ),
  )
}
