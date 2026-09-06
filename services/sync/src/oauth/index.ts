/** The OAuth server in front of the connector, so an LLM client can be given
 *  the URL and sign the person in by itself - nothing to copy anywhere.
 *
 *  The parts, in the order a client meets them:
 *
 *    metadata.ts   where the endpoints are, and what this server supports
 *    clients.ts    who is asking: registration, and clients that describe
 *                  themselves at a URL
 *    authorize.ts  the consent flow, and the code it ends in
 *    consent.ts    the page a person sees while that happens
 *    tokens.ts     the code becoming a token, and the token being refreshed
 *    redirects.ts  where a browser may be sent back to
 *    protocol.ts   the words all of them share
 *
 *  This file only puts them behind the one `/oauth` prefix, in that order. */

import { Hono } from 'hono'
import type { Env } from '../types'
import { authorize } from './authorize'
import { registration } from './clients'
import { tokens } from './tokens'

export { oauthMetadata, challenge } from './metadata'
export { grantForToken } from './tokens'

export const oauth = new Hono<{ Bindings: Env }>()

oauth.route('/', registration)
oauth.route('/', authorize)
oauth.route('/', tokens)
