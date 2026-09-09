/** Asking DNS a question, from a place with no resolver.
 *
 *  A Worker has no sockets and so no way to speak DNS itself. What it has is
 *  `fetch`, and DNS over HTTPS (RFC 8484) is DNS over that. Cloudflare's resolver
 *  is the one asked because this already runs on Cloudflare: it is the nearest
 *  one there is from here, and it is the same resolver that would answer anyway.
 *
 *  The one thing this is careful about is the difference between "the record is
 *  not there" and "nobody could be asked". They read the same at a socket and
 *  they are opposite answers: the first means a domain is unproved, the second
 *  means nothing at all, and treating a resolver's bad afternoon as the first
 *  would unpublish every domain the service serves. So the answer says which. */

import { textAtMost } from './body'

const RESOLVER = 'https://cloudflare-dns.com/dns-query'

/** A resolver answers in a few milliseconds or it is not going to. */
const TIMEOUT = 5_000

/** An answer is a handful of short strings. Anything larger is not one, and the
 *  host is not this service's to trust with its memory. */
const LONGEST = 32_000

/** How many strings at one name are read. A name with more than this on it is
 *  not one anybody put a proof at. */
const MOST_STRINGS = 40

/** What was found at a name, or that nobody could be asked. */
export type Txt = { asked: true; values: string[] } | { asked: false }

interface Answer {
  type?: number
  data?: string
}

/** One TXT string as JSON DNS gives it: quoted, and long values split into
 *  several quoted pieces that belong to one string. */
function unquote(data: string): string {
  const pieces = data.match(/"((?:[^"\\]|\\.)*)"/g)
  if (!pieces) return data.trim()

  return pieces
    .map((piece) => piece.slice(1, -1).replace(/\\(.)/g, '$1'))
    .join('')
    .trim()
}

/** The TXT strings at a name. */
export async function txtAt(name: string): Promise<Txt> {
  try {
    const response = await fetch(`${RESOLVER}?name=${encodeURIComponent(name)}&type=TXT`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!response.ok) return { asked: false }

    const text = await textAtMost(response, LONGEST)
    if (text === null) return { asked: false }

    const reply = JSON.parse(text) as { Status?: number; Answer?: Answer[] }

    // Status 0 is an answer and 3 is "no such name", which is an answer too: the
    // record is not there. Anything else - a server failure, a refusal - is the
    // resolver saying it does not know, and that is not the same thing.
    if (reply.Status !== 0 && reply.Status !== 3) return { asked: false }

    const answers = Array.isArray(reply.Answer) ? reply.Answer : []
    const values = answers
      .filter((one) => one.type === 16 && typeof one.data === 'string')
      .slice(0, MOST_STRINGS)
      .map((one) => unquote(one.data ?? ''))

    return { asked: true, values }
  } catch {
    // A resolver that timed out or answered something that is not JSON. Nothing
    // is known about the name, which is what the answer says.
    return { asked: false }
  }
}
