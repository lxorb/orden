import { Hono } from 'hono'
import type { Env } from '../../../sync-server/src/api'
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
    authorization_response_iss_parameter_supported: true,
  })
})

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

export function challenge(env: Env, at: string, invalid: boolean): string {
  const parts = [
    `resource_metadata="${issuer(env, at)}/.well-known/oauth-protected-resource/mcp"`,
    `scope="${SCOPES.join(' ')}"`,
  ]
  if (invalid) parts.unshift('error="invalid_token"')
  return `Bearer ${parts.join(', ')}`
}
