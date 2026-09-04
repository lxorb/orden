import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ORIGIN = 'https://nibeditor.com'
const CHATGPT = 'https://chatgpt.com/connector/oauth/abc123'

/** PKCE, as a client does it: a random verifier and its S256 challenge. */
async function pkce() {
  const verifier = 'v'.repeat(20) + Math.random().toString(36).slice(2).padEnd(30, 'x')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return { verifier, challenge }
}

/** Registers a public client the way Claude and ChatGPT do. */
async function register(redirectUris = [CHATGPT], extra: Record<string, unknown> = {}) {
  const response = await call(env, '/oauth/register', {
    body: { client_name: 'ChatGPT', redirect_uris: redirectUris, token_endpoint_auth_method: 'none', ...extra },
  })
  return response
}

function authorizeUrl(params: Record<string, string>) {
  const query = new URLSearchParams({
    response_type: 'code',
    redirect_uri: CHATGPT,
    state: 'xyz',
    code_challenge_method: 'S256',
    resource: `${ORIGIN}/mcp`,
    ...params,
  })
  return `/oauth/authorize?${query}`
}

/** Submits one of the consent page's forms. */
async function submit(fields: Record<string, string>) {
  return call(env, '/oauth/authorize', {
    raw: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

/** Reads the emailed code out of the logging mailer. */
async function codeSentTo(action: () => Promise<unknown>): Promise<string> {
  const logged: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
    logged.push(String(message))
  })
  await action()
  spy.mockRestore()

  const match = /(\d{3}) (\d{3})/.exec(logged.join('\n'))
  if (!match) throw new Error('no code was sent')
  return match[1] + match[2]
}

async function exchange(fields: Record<string, string>) {
  return call(env, '/oauth/token', {
    raw: new URLSearchParams({ grant_type: 'authorization_code', ...fields }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

/** The whole dance, as a client and a person would do it, ending in tokens. */
async function connect(options: { write?: boolean; email?: string; clientId?: string; redirect?: string } = {}) {
  const email = options.email ?? 'a@b.dev'
  const clientId = options.clientId ?? (await register()).json.client_id
  const redirect = options.redirect ?? CHATGPT
  const { verifier, challenge } = await pkce()

  const ask = { client_id: clientId, redirect_uri: redirect, state: 'xyz', code_challenge: challenge, resource: `${ORIGIN}/mcp` }

  const code = await codeSentTo(() => submit({ ...ask, action: 'send', email }))
  const allowed = await submit({ ...ask, action: 'allow', email, code, ...(options.write ? { write: '1' } : {}) })

  expect(allowed.status).toBe(302)
  const sentTo = new URL(allowed.headers.get('location')!)
  const grant = sentTo.searchParams.get('code')!

  const tokens = await exchange({
    code: grant,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: redirect,
    resource: `${ORIGIN}/mcp`,
  })

  return { tokens, sentTo, clientId, verifier }
}

async function rpc(token: string, method: string, params?: Record<string, unknown>) {
  return call(env, '/mcp', { token, body: { jsonrpc: '2.0', id: 1, method, params } })
}

describe('what a client can find out on its own', () => {
  test('the authorization server describes itself', async () => {
    const response = await call(env, '/.well-known/oauth-authorization-server')

    expect(response.status).toBe(200)
    expect(response.json.issuer).toBe(ORIGIN)
    expect(response.json.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`)
    expect(response.json.token_endpoint).toBe(`${ORIGIN}/oauth/token`)
    expect(response.json.registration_endpoint).toBe(`${ORIGIN}/oauth/register`)
    expect(response.json.code_challenge_methods_supported).toEqual(['S256'])
    expect(response.json.token_endpoint_auth_methods_supported).toContain('none')
    expect(response.json.client_id_metadata_document_supported).toBe(true)
    expect(response.json.authorization_response_iss_parameter_supported).toBe(true)
  })

  test('the connector says which server signs people in, at both well-known paths', async () => {
    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      const response = await call(env, path)

      expect(response.status, path).toBe(200)
      expect(response.json.resource).toBe(`${ORIGIN}/mcp`)
      expect(response.json.authorization_servers).toEqual([ORIGIN])
      expect(response.json.scopes_supported).toContain('notes:read')
    }
  })

  test('the metadata may be read from a browser', async () => {
    const response = await call(env, '/.well-known/oauth-authorization-server', {
      headers: { origin: 'http://localhost:6274' },
    })
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('a refused connector request points at the metadata', async () => {
    const response = await call(env, '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    )
    expect(response.headers.get('www-authenticate')).not.toContain('invalid_token')
  })

  test('a bad token is called that', async () => {
    const response = await rpc('nib_nonsense', 'ping')
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })

  test('there is no stream to open', async () => {
    const response = await call(env, '/mcp')
    expect(response.status).toBe(405)
  })
})

describe('registering', () => {
  test('hands a public client an id and no secret', async () => {
    const response = await register()

    expect(response.status).toBe(201)
    expect(response.json.client_id).toBeTruthy()
    expect(response.json.client_secret).toBeUndefined()
    expect(response.json.token_endpoint_auth_method).toBe('none')
    expect(response.json.redirect_uris).toEqual([CHATGPT])
  })

  test('takes the callbacks Claude, ChatGPT, Claude Code and the editors use', async () => {
    const response = await register([
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.com/api/mcp/auth_callback',
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'http://localhost:3118/callback',
      'http://127.0.0.1:33418',
      'https://vscode.dev/redirect',
      'cursor://anysphere.cursor-mcp/oauth/callback',
    ])
    expect(response.status).toBe(201)
  })

  test('refuses a callback that is neither https nor local', async () => {
    const response = await register(['http://example.com/callback'])

    expect(response.status).toBe(400)
    expect(response.json.error).toBe('invalid_redirect_uri')
  })

  test('refuses a registration with nowhere to send the person', async () => {
    const response = await call(env, '/oauth/register', { body: { client_name: 'X' } })
    expect(response.status).toBe(400)
  })

  test('gives a client that registers again the same id', async () => {
    const first = await register()
    const second = await register()

    expect(second.json.client_id).toBe(first.json.client_id)
  })

  test('mints a secret for a client that wants one, and then insists on it', async () => {
    const response = await register([CHATGPT], { token_endpoint_auth_method: 'client_secret_post' })

    expect(response.json.client_secret).toMatch(/^[0-9a-f]{64}$/)
    expect(response.json.token_endpoint_auth_method).toBe('client_secret_post')

    const without = await exchange({ client_id: response.json.client_id, code: 'x', code_verifier: 'y'.repeat(43) })
    expect(without.status).toBe(401)
    expect(without.json.error).toBe('invalid_client')

    const wrong = await exchange({
      client_id: response.json.client_id,
      client_secret: 'nope',
      code: 'x',
      code_verifier: 'y'.repeat(43),
    })
    expect(wrong.status).toBe(401)
  })
})

describe('asking for consent', () => {
  test('shows the client by name and says where the person goes afterwards', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await call(env, authorizeUrl({ client_id, code_challenge: challenge }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.text).toContain('Connect ChatGPT')
    expect(response.text).toContain('chatgpt.com')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  test('refuses an unknown client on a page rather than by redirecting', async () => {
    const { challenge } = await pkce()
    const response = await call(env, authorizeUrl({ client_id: 'nobody', code_challenge: challenge }))

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  test('refuses a callback the client never registered, on a page', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id, code_challenge: challenge, redirect_uri: 'https://evil.example/cb' }),
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('location')).toBeNull()
  })

  test('sends the client an error when PKCE is missing', async () => {
    const { client_id } = (await register()).json
    const response = await call(env, authorizeUrl({ client_id }))

    expect(response.status).toBe(302)
    const sentTo = new URL(response.headers.get('location')!)
    expect(sentTo.origin + sentTo.pathname).toBe(CHATGPT)
    expect(sentTo.searchParams.get('error')).toBe('invalid_request')
    expect(sentTo.searchParams.get('state')).toBe('xyz')
    expect(sentTo.searchParams.get('iss')).toBe(ORIGIN)
  })

  test('sends the client an error when the token is meant for somewhere else', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id, code_challenge: challenge, resource: 'https://other.example/mcp' }),
    )

    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('invalid_target')
  })

  test('lets a local app answer on whichever port it has', async () => {
    const { client_id } = (await register(['http://localhost/callback'])).json
    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id, code_challenge: challenge, redirect_uri: 'http://localhost:3118/callback' }),
    )

    expect(response.status).toBe(200)
    expect(response.text).toContain('an app on this computer')
  })

  test('offers writing only when the client asked for it', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    await codeSentTo(() => submit({ ...ask, scope: 'notes:read', action: 'send', email: 'a@b.dev' }))
    const readOnly = await submit({ ...ask, scope: 'notes:read', action: 'send', email: 'a@b.dev' })
    expect(readOnly.text).not.toContain('change my notes')

    const both = await submit({ ...ask, scope: 'notes:read notes:write', action: 'send', email: 'a@b.dev' })
    expect(both.text).toContain('change my notes')
  })

  test('says no to the client when the person does', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const response = await submit({
      client_id,
      redirect_uri: CHATGPT,
      state: 'xyz',
      code_challenge: challenge,
      action: 'deny',
    })

    expect(response.status).toBe(302)
    const sentTo = new URL(response.headers.get('location')!)
    expect(sentTo.searchParams.get('error')).toBe('access_denied')
    expect(sentTo.searchParams.get('state')).toBe('xyz')
  })

  test('keeps a wrong code on the page', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge, email: 'a@b.dev' }

    await codeSentTo(() => submit({ ...ask, action: 'send' }))
    const response = await submit({ ...ask, action: 'allow', code: '000000' })

    expect(response.status).toBe(200)
    expect(response.text).toContain('not right')
  })
})

describe('connecting', () => {
  test('ends with a token that reaches the notes', async () => {
    const { tokens, sentTo } = await connect()

    expect(sentTo.searchParams.get('state')).toBe('xyz')
    expect(sentTo.searchParams.get('iss')).toBe(ORIGIN)

    expect(tokens.status).toBe(200)
    expect(tokens.json.token_type).toBe('Bearer')
    expect(tokens.json.access_token).toMatch(/^nib_/)
    expect(tokens.json.refresh_token).toBeTruthy()
    expect(tokens.json.scope).toBe('notes:read')
    expect(tokens.headers.get('cache-control')).toBe('no-store')

    const listed = await rpc(tokens.json.access_token, 'tools/list')
    expect(listed.status).toBe(200)
  })

  test('reads and writes only what the person allowed', async () => {
    const session = await signIn(env, 'a@b.dev')
    await call(env, '/v1/spaces', { token: session, body: { name: 'Work' } })

    const readOnly = (await connect()).tokens.json.access_token
    const writing = (await connect({ write: true })).tokens.json.access_token

    const refused = await rpc(readOnly, 'tools/call', {
      name: 'write_note',
      arguments: { space: 'Work', path: 'a.md', content: 'x' },
    })
    expect(refused.json.result.content[0].text).toContain('only read')

    const saved = await rpc(writing, 'tools/call', {
      name: 'write_note',
      arguments: { space: 'Work', path: 'a.md', content: 'x' },
    })
    expect(saved.json.result.content[0].text).toContain('Saved')
  })

  test('signs up an address it has never seen', async () => {
    const { tokens } = await connect({ email: 'new@b.dev' })
    const spaces = await rpc(tokens.json.access_token, 'tools/call', { name: 'list_spaces', arguments: {} })

    expect(spaces.json.result.content[0].text).toContain('No spaces')
  })

  test('takes the token request as JSON too', async () => {
    const { client_id } = (await register()).json
    const { verifier, challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    const tokens = await call(env, '/oauth/token', {
      body: { grant_type: 'authorization_code', code: grant, code_verifier: verifier, client_id, redirect_uri: CHATGPT },
    })
    expect(tokens.status).toBe(200)
  })

  test('refuses the wrong verifier', async () => {
    const { client_id } = (await register()).json
    const { challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    const tokens = await exchange({ code: grant, code_verifier: (await pkce()).verifier, client_id, redirect_uri: CHATGPT })
    expect(tokens.status).toBe(400)
    expect(tokens.json.error).toBe('invalid_grant')
  })

  test('spends a code on the first try, right or wrong', async () => {
    const { client_id } = (await register()).json
    const { verifier, challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    expect((await exchange({ code: grant, code_verifier: verifier, client_id })).status).toBe(200)
    expect((await exchange({ code: grant, code_verifier: verifier, client_id })).json.error).toBe('invalid_grant')
  })

  test('refuses a code presented by another client', async () => {
    const { client_id } = (await register()).json
    const other = (await register([CHATGPT], { client_name: 'Other' })).json.client_id
    const { verifier, challenge } = await pkce()
    const ask = { client_id, redirect_uri: CHATGPT, code_challenge: challenge }

    const code = await codeSentTo(() => submit({ ...ask, action: 'send', email: 'a@b.dev' }))
    const allowed = await submit({ ...ask, action: 'allow', email: 'a@b.dev', code })
    const grant = new URL(allowed.headers.get('location')!).searchParams.get('code')!

    const tokens = await exchange({ code: grant, code_verifier: verifier, client_id: other })
    expect(tokens.json.error).toBe('invalid_grant')
  })

  test('refuses a token for somewhere else', async () => {
    const { client_id } = (await register()).json
    const tokens = await exchange({
      client_id,
      code: 'x',
      code_verifier: 'y'.repeat(43),
      resource: 'https://other.example',
    })
    expect(tokens.json.error).toBe('invalid_target')
  })
})

describe('refreshing', () => {
  async function refresh(clientId: string, token: string) {
    return call(env, '/oauth/token', {
      raw: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token, client_id: clientId }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  }

  test('hands out new tokens and retires the old access token', async () => {
    const { tokens, clientId } = await connect()
    const refreshed = await refresh(clientId, tokens.json.refresh_token)

    expect(refreshed.status).toBe(200)
    expect(refreshed.json.access_token).not.toBe(tokens.json.access_token)
    expect(refreshed.json.refresh_token).not.toBe(tokens.json.refresh_token)

    expect((await rpc(tokens.json.access_token, 'ping')).status).toBe(401)
    expect((await rpc(refreshed.json.access_token, 'ping')).status).toBe(200)
  })

  test('forgives a client that never received the reply', async () => {
    const { tokens, clientId } = await connect()
    const first = await refresh(clientId, tokens.json.refresh_token)

    // The token before the current one still works once...
    const again = await refresh(clientId, tokens.json.refresh_token)
    expect(again.status).toBe(200)

    // ...and using it retires the one it was replaced by.
    expect((await refresh(clientId, first.json.refresh_token)).json.error).toBe('invalid_grant')
    expect((await refresh(clientId, again.json.refresh_token)).status).toBe(200)
  })

  test('refuses another client', async () => {
    const { tokens } = await connect()
    const other = (await register([CHATGPT], { client_name: 'Other' })).json.client_id

    expect((await refresh(other, tokens.json.refresh_token)).json.error).toBe('invalid_grant')
  })

  test('says invalid_grant for a token it never issued', async () => {
    const { clientId } = await connect()
    expect((await refresh(clientId, 'nibr_made_up')).json.error).toBe('invalid_grant')
  })
})

describe('a client that describes itself at a URL', () => {
  const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'

  function hosting(document: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === CLAUDE_CODE
          ? new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } })
          : new Response('not found', { status: 404 }),
      ),
    )
  }

  test('is taken at its word, port and all', async () => {
    hosting({
      client_id: CLAUDE_CODE,
      client_name: 'Claude Code',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
    })

    const { tokens, sentTo } = await connect({
      clientId: CLAUDE_CODE,
      redirect: 'http://localhost:3118/callback',
    })

    expect(sentTo.origin).toBe('http://localhost:3118')
    expect(tokens.status).toBe(200)

    const listed = await call(env, '/v1/mcp/token', { token: await signIn(env, 'a@b.dev') })
    expect(listed.json.clients[0].name).toBe('Claude Code')
  })

  test('is refused when the document does not name itself', async () => {
    hosting({ client_id: 'https://elsewhere.example/x', client_name: 'X', redirect_uris: [CHATGPT] })

    const { challenge } = await pkce()
    const response = await call(env, authorizeUrl({ client_id: CLAUDE_CODE, code_challenge: challenge }))
    expect(response.status).toBe(400)
  })

  test('is refused when there is no document', async () => {
    hosting({})

    const { challenge } = await pkce()
    const response = await call(
      env,
      authorizeUrl({ client_id: 'https://claude.ai/nothing-here', code_challenge: challenge }),
    )
    expect(response.status).toBe(400)
  })
})

describe('what the settings show', () => {
  test('lists the connected clients and lets one go', async () => {
    const session = await signIn(env, 'a@b.dev')
    const { tokens } = await connect({ write: true })

    const before = await call(env, '/v1/mcp/token', { token: session })
    expect(before.json.clients).toHaveLength(1)
    expect(before.json.clients[0].name).toBe('ChatGPT')
    expect(before.json.clients[0].readOnly).toBe(false)

    const gone = await call(env, `/v1/mcp/clients/${before.json.clients[0].id}`, {
      token: session,
      method: 'DELETE',
    })
    expect(gone.status).toBe(200)

    expect((await call(env, '/v1/mcp/token', { token: session })).json.clients).toHaveLength(0)
    expect((await rpc(tokens.json.access_token, 'ping')).status).toBe(401)
  })

  test('keeps one account from disconnecting another', async () => {
    const owner = await signIn(env, 'a@b.dev')
    const other = await signIn(env, 'other@b.dev')
    const { tokens } = await connect()

    const listed = await call(env, '/v1/mcp/token', { token: owner })
    await call(env, `/v1/mcp/clients/${listed.json.clients[0].id}`, { token: other, method: 'DELETE' })

    expect((await rpc(tokens.json.access_token, 'ping')).status).toBe(200)
  })
})
