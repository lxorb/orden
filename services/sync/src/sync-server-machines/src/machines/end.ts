import { chunks, places, now, askHub, type Ended, type Env } from '../../../sync-server/src/api'
import { askMachine } from './ask'
import { audit } from './audit'

export async function endTerms(
  env: Env,
  terms: readonly string[],
  who: string | null,
): Promise<void> {
  const ended: Ended[] = []
  const at = now()
  for (const chunk of chunks(terms)) {
    const { results } = await env.DB.prepare(
      `update term_sessions set ended_at = ?
        where ended_at is null and term <> session and term in (${places(chunk.length)})
       returning machine, session, user_id`,
    )
      .bind(at, ...chunk)
      .all<Ended>()
    ended.push(...results)
  }
  await tellEnded(env, ended, who)
}

export function endingTerm(env: Env, term: string, at: number): D1PreparedStatement {
  return env.DB.prepare(
    `update term_sessions set ended_at = ?
      where ended_at is null and term <> session and term = ?
     returning machine, session, user_id`,
  ).bind(at, term)
}

export async function tellEnded(
  env: Env,
  ended: readonly Ended[],
  who: string | null,
): Promise<void> {
  for (const one of ended) {
    await audit(env, one.machine, 'ended', { who })
    await askMachine(env, one.machine, 'end', {
      'x-orden-user': one.user_id,
      'x-orden-session': one.session,
    })
  }
  for (const owner of new Set(ended.map((one) => one.user_id))) {
    await askHub(env, owner, 'terms')
  }
}
