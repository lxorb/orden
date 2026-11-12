import type { Env } from '../../../sync-server/src/api'
import { askMachine } from './ask'

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
       from term_sessions t join notes n on n.id = t.term and t.term <> t.session
      where n.space_id = ?1 and t.ended_at is null and (?2 = '' or t.term = ?2)
        and t.user_id <> ?3
      group by t.machine, t.user_id limit ?4`,
  )
    .bind(spaceId, item, who, MOST_MACHINES)
    .all<{ machine: string; owner: string; terms: string }>()

  await Promise.all(
    results.map((one) =>
      askMachine(env, one.machine, 'revoke', {
        'x-orden-user': one.owner,
        'x-orden-who': who,
        'x-orden-role': role,
        'x-orden-terms': one.terms,
      }),
    ),
  )
}

const MOST_LOGINS = 100

export async function machinesSignedOut(
  env: Env,
  who: string,
  logins: readonly string[],
): Promise<void> {
  const ended = logins.filter(Boolean).slice(0, MOST_LOGINS)
  if (!env.MACHINES || !who || !ended.length) return

  const { results } = await env.DB.prepare(
    `select distinct t.machine as machine
       from term_sessions t left join notes n on n.id = t.term and t.term <> t.session
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
      askMachine(env, one.machine, 'signedout', { 'x-orden-logins': ended.join(',') }),
    ),
  )
}
