/** What a client is told about this server before it has asked for anything.
 *
 *  A client finds everything on its own: where the endpoints are (RFC 8414 and
 *  RFC 9728), how to introduce itself (by registering, RFC 7591, or with an id
 *  that is the URL of its own description), and the code flow with PKCE that
 *  OAuth 2.1 and the MCP specification ask for. */

import { Hono } from 'hono'
import type { Env } from '../types'
import { GRANTS, issuer, resourceUrl, SCOPES } from './protocol'

export const oauthMetadata = new Hono<{ Bindings: Env }>()

oauthMetadata.get('/oauth-authorization-server', (context) => {
  const base = issuer(context.env, context.req.url)

  return context.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: GRANTS,
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: SCOPES,
    client_id_metadata_document_supported: true,
    // The `iss` on every redirect is what lets ChatGPT use one fixed callback
    // rather than one per connector.
    authorization_response_iss_parameter_supported: true,
  })
})

/** The same document at the plain path and at the one with the connector's
 *  path folded in: RFC 9728 asks for the second, older clients try the first. */
function protectedResource(env: Env, at: string) {
  return {
    resource: resourceUrl(env, at),
    authorization_servers: [issuer(env, at)],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Orden',
  }
}

oauthMetadata.get('/oauth-protected-resource', (context) =>
  context.json(protectedResource(context.env, context.req.url)),
)
oauthMetadata.get('/oauth-protected-resource/mcp', (context) =>
  context.json(protectedResource(context.env, context.req.url)),
)

/** What a refused connector request carries, so a client knows where to go:
 *  `at` is the refused request's URL, whose name the client knows the server by. */
export function challenge(env: Env, at: string, invalid: boolean): string {
  const parts = [
    `resource_metadata="${issuer(env, at)}/.well-known/oauth-protected-resource/mcp"`,
    `scope="${SCOPES.join(' ')}"`,
  ]
  if (invalid) parts.unshift('error="invalid_token"')
  return `Bearer ${parts.join(', ')}`
}
