/** Proving that a domain of one's own is one's own.
 *
 *  A row saying `blog_domain = 'notes.example.com'` is not a claim to that name;
 *  it is a sentence somebody typed. Taken as one it did two things wrong: the
 *  first person to type a domain held it for ever, so the real owner was told
 *  "that domain is taken" by somebody who had never owned it, and Nib went and
 *  asked Cloudflare for a certificate for a name belonging to a stranger.
 *
 *  What holding a domain actually means is being able to write a record in it. So
 *  a claim waits on one: `_nib-verify.<domain>` holding the token the app shows,
 *  read over DNS over HTTPS. Three things follow from that, and they are the whole
 *  of this module:
 *
 *    - A claimed domain that is not proved serves nothing. `spaceForHost` asks
 *      for the stamp, so there is no answer on a name nobody has proved.
 *    - A claimed domain that is not proved is nobody's. A second claim on one
 *      takes it, which is what lets the owner in after a squatter.
 *    - A proof is read again on a schedule, because a domain changes hands.
 *      Weeks of grace, because a record that answers nothing tonight is far more
 *      often a resolver having a bad afternoon than a domain that has moved. */

import { now, randomToken } from '../crypto'
import { txtAt } from '../dns'
import { claimDomain, releaseDomain } from '../hostnames'
import type { Env, Space } from '../types'
import { proofName } from './addresses'

/** The value the owner puts in the record. Self-describing, because it sits in a
 *  zone file among a dozen others and whoever finds it in a year should be able
 *  to tell what it is for. */
export function newProof(): string {
  return `nib-verify=${randomToken()}`
}

/** How old a proof may get before it is read again. */
const PROVED_FOR = 7 * 24 * 60 * 60 * 1000

/** And how old it may get while the record is not answering, before the domain
 *  stops being served. Three weeks, so a record deleted by accident is something
 *  the owner has time to notice, and a domain that has really changed hands stops
 *  answering as Nib inside the month. */
const TRUSTED_FOR = 3 * PROVED_FOR

/** One sentence, for both of the ways this fails.
 *
 *  A record that is not there and a resolver that would not answer are one thing
 *  to the person at the registrar - the proof is not readable yet, so wait or
 *  check what was typed - and the difference matters to the schedule rather than
 *  to them. */
const NOT_YET = 'that record is not answering yet'

/** Reads the record and stamps the space when it says what it should.
 *
 *  Asked for by the owner pressing the button, so it happens now rather than on
 *  the next run: adding a record and being told at once whether it took is the
 *  whole of the interaction. */
export async function proveDomain(
  env: Env,
  space: Space,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const domain = space.blog_domain
  const token = space.blog_domain_token
  if (!domain || !token) return { ok: false, error: 'choose an address' }

  const found = await txtAt(proofName(domain))
  if (!found.asked || !found.values.includes(token)) return { ok: false, error: NOT_YET }

  await env.DB.prepare('update spaces set blog_domain_verified_at = ? where id = ?')
    .bind(now(), space.id)
    .run()

  // Only now is there anything to ask Cloudflare for. A certificate for a name
  // somebody merely typed is exactly what this module exists to prevent.
  await claimDomain(env, domain)

  return { ok: true }
}

/** Every proof that has got old, read again. Part of the nightly job.
 *
 *  A domain whose record still says the right thing has its stamp moved on, which
 *  is the same stamp that says it may serve: the proof is as young as the last
 *  time anybody saw it. One that does not is left alone until the grace has run
 *  out, and then stops being served and gives its certificate back.
 *
 *  Oldest first and a batch at a time, because this is one invocation beside
 *  everything else the night does, and each one of these is a request over the
 *  network. */
export async function recheckDomains(env: Env, at: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `select id, blog_domain, blog_domain_token, blog_domain_verified_at from spaces
      where blog_domain is not null and blog_domain_token is not null
        and blog_domain_verified_at is not null and blog_domain_verified_at < ?
      order by blog_domain_verified_at limit 100`,
  )
    .bind(at - PROVED_FOR)
    .all<{
      id: string
      blog_domain: string
      blog_domain_token: string
      blog_domain_verified_at: number
    }>()

  let lost = 0

  for (const space of results) {
    const found = await txtAt(proofName(space.blog_domain))

    // A resolver that could not be asked is not a domain that changed hands.
    if (!found.asked) continue

    if (found.values.includes(space.blog_domain_token)) {
      await env.DB.prepare('update spaces set blog_domain_verified_at = ? where id = ?')
        .bind(at, space.id)
        .run()
      continue
    }

    if (at - space.blog_domain_verified_at < TRUSTED_FOR) continue

    await env.DB.prepare('update spaces set blog_domain_verified_at = null where id = ?')
      .bind(space.id)
      .run()
    await releaseDomain(env, space.blog_domain)
    lost++
  }

  return lost
}
