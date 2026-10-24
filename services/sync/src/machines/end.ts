/** A `.term` file gone for good, and the session it named ended with it
 *  (docs/online-terminal.md, 4.5): deleting the file leaves the shell running, reachable
 *  by its owner from Settings, and emptying the trash ends it.
 *
 *  Called wherever a file's words go for good - a note purged from Recently deleted, a
 *  space emptied, an account erased with the spaces it owned - because the row of a
 *  session is keyed by the file's id and nothing else would end it: the shell would go on
 *  out of everybody's reach but its owner's, and count toward the machine's eight. */

import { chunks, places } from '../bound'
import { now } from '../crypto'
import { askHub } from '../hub/reach'
import type { Env } from '../types'
import { askMachine } from './ask'
import { audit } from './audit'

/** A live session, as its machine is told it ended. */
export interface Ended {
  machine: string
  session: string
  user_id: string
}

/** Ends the live sessions of these files: the rows first, then each machine and each
 *  owner's devices told, as `DELETE /v2/online/terms/:term` does. `who` is whoever emptied
 *  the trash, for the audit; null for the nightly job. */
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
        where ended_at is null and term in (${places(chunk.length)})
       returning machine, session, user_id`,
    )
      .bind(at, ...chunk)
      .all<Ended>()
    ended.push(...results)
  }
  await tellEnded(env, ended, who)
}

/** Tells each machine about sessions whose rows have already ended, and each owner's
 *  devices, so Settings' list drops them. Never a throw past a machine that could not
 *  be asked: the row is what counts, and the machine reads the rows again. */
export async function tellEnded(
  env: Env,
  ended: readonly Ended[],
  who: string | null,
): Promise<void> {
  for (const one of ended) {
    await audit(env, one.machine, 'ended', { who })
    await askMachine(env, one.machine, 'end', {
      'x-nib-user': one.user_id,
      'x-nib-session': one.session,
    })
  }
  for (const owner of new Set(ended.map((one) => one.user_id))) {
    await askHub(env, owner, 'terms')
  }
}
