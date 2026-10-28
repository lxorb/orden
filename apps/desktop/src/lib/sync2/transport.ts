/** The engine's requests, as HTTP: the routes of docs/sync-v2.md section 7, in the
 *  framed envelope both ends speak (`frame` in @orden/sync-core/wire), so a Yjs update
 *  travels as its bytes.
 *
 *  What a pass needs to hear is one of three things. An answer. No answer - the network
 *  is down, the account is busy (a 429, a 5xx) - which a pass reads as "stop here and
 *  try again later", and which is what keeps the corner light hollow rather than red. Or
 *  a refusal of the request itself: a session that has ended (401, which signs the app
 *  out the way every other request does), or something the account will not do for
 *  this person (403, 404), which the step that asked decides about. */

import { frame, unframe } from '@orden/sync-core/wire'
import type { Blobs, Replaced } from './files'
import type { Account, Route } from './world'

/** A request the account refused outright, rather than one that went unanswered. */
export class Refused extends Error {
  override name = 'Refused'
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const OCTETS = 'application/octet-stream'

/** The account's answer to bytes it has no room for: Insufficient Storage. */
const FULL = 507

/** Where each route is. */
function pathOf(route: Route, space: string, body: unknown): string {
  const at = encodeURIComponent(space)
  switch (route) {
    case 'prepare':
    case 'ops':
      return `/v2/spaces/${at}/${route}`
    case 'feed': {
      const since =
        typeof body === 'object' && body !== null && 'since' in body ? Number(body.since) : 0
      return `/v2/spaces/${at}/feed?since=${String(Number.isFinite(since) ? since : 0)}`
    }
    case 'pull':
    case 'push':
    case 'keep':
      return `/v2/docs/${route}`
  }
}

export interface Reaching {
  /** The service's address, with no slash at the end. */
  base: string
  token: () => string | null
  /** What this device is called: the name a version it sends is written under. */
  device: () => string
  /** `fetch`, or a stand-in for it. */
  fetch: (request: Request) => Promise<Response>
}

/** The account, over HTTP. */
export function accountOver(reaching: Reaching): Account {
  return {
    async ask(route, body, space) {
      const token = reaching.token()
      if (!token) return null
      const reading = route === 'feed'
      const request = new Request(`${reaching.base}${pathOf(route, space, body)}`, {
        method: reading ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: OCTETS,
          'x-nib-device': reaching.device(),
          ...(reading ? {} : { 'content-type': OCTETS }),
        },
        ...(reading ? {} : { body: new Uint8Array(frame(body)) }),
      })

      let response: Response
      try {
        response = await reaching.fetch(request)
      } catch {
        // No network, or none that reaches the service.
        return null
      }
      if (response.status === 429 || response.status >= 500) return null
      if (!response.ok) {
        const said: unknown = await response.json().catch(() => null)
        const error =
          typeof said === 'object' && said !== null && 'error' in said ? String(said.error) : ''
        throw new Refused(response.status, error || `request failed (${String(response.status)})`)
      }
      return unframe(new Uint8Array(await response.arrayBuffer()))
    },
  }
}

/** The bytes of files that are not documents, over HTTP (docs/sync-v2.md section 7,
 *  Files): up as a blob under their hash, down through their space, and a replacement
 *  named against the bytes it replaced. No answer is null, as for every route above; a
 *  refusal of the bytes is `false`, and `full` when the account has no room for them
 *  (507), and the file waits. A 507 is an answer, not an account too busy to give one:
 *  read as none, it stopped every pass of the space at that one file. */
export function remoteFiles(reaching: Reaching): Pick<Blobs, 'up' | 'down' | 'replace' | 'have'> {
  /** `full` says whether a 507 is the answer it is to this request, rather than none. */
  const send = async (path: string, init: RequestInit, full = false): Promise<Response | null> => {
    const token = reaching.token()
    if (!token) return null
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    headers.set('x-nib-device', reaching.device())
    try {
      const response = await reaching.fetch(
        new Request(`${reaching.base}${path}`, { ...init, headers }),
      )
      if (full && response.status === FULL) return response
      return response.status === 429 || response.status >= 500 ? null : response
    } catch {
      return null
    }
  }

  return {
    async up(hash, bytes) {
      const response = await send(
        `/v2/blobs/${hash}`,
        {
          method: 'PUT',
          headers: { 'content-type': OCTETS },
          body: new Uint8Array(bytes),
        },
        true,
      )
      if (response === null) return null
      return response.status === FULL ? 'full' : response.ok
    },
    async down(space, id) {
      const response = await send(
        `/v2/files/${encodeURIComponent(space)}/${encodeURIComponent(id)}`,
        { method: 'GET' },
      )
      if (response === null) return null
      if (!response.ok) return 'gone'
      return new Uint8Array(await response.arrayBuffer())
    },
    async have(hashes) {
      const response = await send('/v2/blobs/have', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hashes }),
      })
      // No answer, or an account from before the question (a 404): not asked again until
      // the next check, and nothing is sent on the strength of it.
      if (!response?.ok) return null
      const said: unknown = await response.json().catch(() => null)
      const kept =
        typeof said === 'object' && said !== null ? (said as { kept?: unknown }).kept : null
      return Array.isArray(kept) ? new Set(kept.filter((one) => typeof one === 'string')) : null
    },
    async replace(space, id, hash, base) {
      const response = await send(
        `/v2/files/${encodeURIComponent(space)}/${encodeURIComponent(id)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ hash, base }),
        },
      )
      if (response === null) return null
      if (response.status === 404) return { gone: true }
      // The space is one this account may only read; nothing but the role is a 403 here.
      if (response.status === 403) return { refused: 'role' }
      if (!response.ok) return null
      const said: unknown = await response.json().catch(() => null)
      if (typeof said !== 'object' || said === null) return null
      if ('moved' in said) return said as Extract<Replaced, { moved: unknown }>
      if ('ok' in said && 'seq' in said) return { ok: true, seq: Number(said.seq) }
      return null
    },
  }
}
