/** Where a published space can be reached: a name on the shared domain, or a
 *  domain of its own. What each may look like, which names are not on offer,
 *  and what the owner has to add at their registrar. */

import type { Env, Space } from '../types'

// Two to thirty-two, which is what the message beside it promises. The
// optional group made one character legal and two impossible.
export const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/

/** What DNS allows a name to be, in total. The per-label rule is in the
 *  pattern; this is the other half of it, and without it a name of two
 *  hundred legal labels would be accepted and then never resolve. */
export const DOMAIN_LIMIT = 253

/** Names people cannot take on the shared blog domain.
 *
 *  Only what is in use, or must not be usable, is held back; a name that is
 *  merely plausible is free until the day it is needed. The list was derived
 *  on 2026-09-04 from the zone itself: its records are the apex, the wildcard
 *  that serves every blog, and Email Routing's MX, SPF and DKIM; its Worker
 *  routes are the apex and the wildcard; it has no Worker custom domains. So
 *  nothing named is in use, and what is kept is structural: `www` because
 *  it is the site by convention, the mail names because mail records exist,
 *  and the nameserver names because a blog there would be read as the zone's
 *  own. The CNAME target for domains of one's own is held back too, from its
 *  setting rather than from here, since it is the one name that must never
 *  publish anything.
 *
 *  Extend this when a record, route or custom domain is added on a new label
 *  of the zone, and only then. */
const RESERVED = new Set(['www', 'mail', 'smtp', 'imap', 'ns', 'ns1', 'ns2'])

export function reserved(env: Env, subdomain: string): boolean {
  return RESERVED.has(subdomain) || subdomain === env.BLOG_CNAME_TARGET.split('.')[0]
}

/** A domain as it is written down: no scheme, no path, no case, no trailing
 *  dot. A name that survives this is one DNS could resolve. */
export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
}

export function looksLikeDomain(domain: string): boolean {
  return domain.length <= DOMAIN_LIMIT && DOMAIN.test(domain)
}

/** Whether a domain is the app's own, or sits under it.
 *
 *  The shared domain and everything under it are the app's and the pool's. A
 *  row naming the apex would put a blog in front of the app for everyone; one
 *  naming a subdomain would be a name taken without going through the pool,
 *  and a certificate asked for inside the zone's own. */
export function ours(env: Env, domain: string): boolean {
  const roots = [env.BLOG_ROOT, new URL(env.APP_ORIGIN).hostname]
  return roots.some((root) => domain === root || domain.endsWith(`.${root}`))
}

/** Where the proof of a domain is looked for. A name under the domain itself,
 *  because only whoever holds the domain can write there - which is the whole of
 *  what the proof proves. */
export function proofName(domain: string): string {
  return `_nib-verify.${domain}`
}

/** What the owner has to add at their registrar to point a domain here: one
 *  CNAME to the shared target, and one TXT record that says the domain is
 *  theirs. The target is fixed rather than the space's own name, because a space
 *  on a domain of its own has no name on the shared domain, and because
 *  Cloudflare validates the certificate by that CNAME.
 *
 *  Two labels is the root of a domain, where DNS forbids a CNAME. Most
 *  providers offer an ALIAS or ANAME record, or flatten the CNAME themselves;
 *  the note says so. A longer name can be a root too (example.co.uk), which
 *  the owner will know and the note does not need to.
 *
 *  The TXT record stays listed after the domain is proved, because it is read
 *  again on a schedule: a record taken away is a domain that has changed hands.
 *  See src/spaces/proof.ts. */
export function dnsRecords(
  env: Env,
  space: Space,
): { type: string; name: string; value: string; note?: string }[] {
  if (!space.blog_domain) return []

  const apex = space.blog_domain.split('.').length === 2
  return [
    {
      type: 'CNAME',
      name: space.blog_domain,
      value: env.BLOG_CNAME_TARGET,
      ...(apex
        ? {
            note: 'At the root of a domain, use an ALIAS or ANAME record, or CNAME flattening, if your provider does not allow a CNAME there.',
          }
        : {}),
    },
    ...(space.blog_domain_token
      ? [
          {
            type: 'TXT',
            name: proofName(space.blog_domain),
            value: space.blog_domain_token,
          },
        ]
      : []),
  ]
}
