import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Host, Posted, ProviderEvent } from '../provider'
import { secretName } from '../provider'
import { toBase64 } from './bytes'
import { FakeMail, nodeSocket } from './fake-server'
import {
  challengeOf,
  claimsOf,
  GOOGLE,
  gmailProvider,
  MICROSOFT,
  microsoftProvider,
  oauthMailProvider,
  type OAuthService,
} from './oauth'

const ADDRESS = 'emil@example.org'

const urlSafe = (text: string) =>
  toBase64(new TextEncoder().encode(text))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const idToken = (claims: Record<string, unknown>) =>
  `${urlSafe('{"alg":"RS256"}')}.${urlSafe(JSON.stringify(claims))}.signature`

class FakeOAuth {
  issued = 0
  refusing = false
  rotate = false
  lasts = 3600
  claims: Record<string, unknown> = { email: ADDRESS }
  asked: URL[] = []
  forms: Record<string, string>[] = []
  refresh = 'refresh-1'
  private codes = new Map<string, { challenge: string; redirect: string }>()

  constructor(
    private readonly mail: FakeMail,
    private readonly client: { id: string; secret?: string },
  ) {}

  authorize(url: string, answer: (asked: URL) => Record<string, string>): Record<string, string> {
    const asked = new URL(url)
    this.asked.push(asked)
    const code = `code-${this.asked.length}`
    this.codes.set(code, {
      challenge: asked.searchParams.get('code_challenge') ?? '',
      redirect: asked.searchParams.get('redirect_uri') ?? '',
    })
    return answer(asked)
  }

  private access(): string {
    const token = `access-${++this.issued}`
    this.mail.tokens.add(token)
    return token
  }

  async post(form: Readonly<Record<string, string>>): Promise<Posted> {
    this.forms.push({ ...form })
    const refuse = (error: string): Posted => ({ status: 400, body: JSON.stringify({ error }) })
    if (form.client_id !== this.client.id) return refuse('invalid_client')
    if (form.client_secret !== this.client.secret) return refuse('invalid_client')
    if (form.grant_type === 'authorization_code') {
      const held = this.codes.get(form.code ?? '')
      if (!held) return refuse('invalid_grant')
      this.codes.delete(form.code ?? '')
      if (held.redirect !== form.redirect_uri) return refuse('invalid_grant')
      if ((await challengeOf(form.code_verifier ?? '')) !== held.challenge) {
        return refuse('invalid_grant')
      }
      return {
        status: 200,
        body: JSON.stringify({
          access_token: this.access(),
          expires_in: this.lasts,
          refresh_token: this.refresh,
          id_token: idToken(this.claims),
        }),
      }
    }
    if (form.grant_type === 'refresh_token') {
      if (this.refusing || form.refresh_token !== this.refresh) return refuse('invalid_grant')
      if (this.rotate) this.refresh = `refresh-${this.issued + 2}`
      return {
        status: 200,
        body: JSON.stringify({
          access_token: this.access(),
          expires_in: this.lasts,
          ...(this.rotate ? { refresh_token: this.refresh } : {}),
        }),
      }
    }
    return refuse('unsupported_grant_type')
  }
}

describe('mail signed in with OAuth, end to end against a server', () => {
  let mail: FakeMail
  let auth: FakeOAuth
  let clock: number
  let secrets: Map<string, string>
  let answer: (asked: URL) => Record<string, string>
  let service: OAuthService
  let host: Host

  const own = { clientId: 'orden-desktop', clientSecret: 'not-really-secret' }

  beforeEach(async () => {
    mail = new FakeMail()
    mail.bearer = true
    await mail.listen()
    mail.deliver(
      'INBOX',
      [
        'From: Lucile <lucile@example.org>',
        `To: ${ADDRESS}`,
        'Subject: Lunch',
        'Date: Mon, 2 Nov 2026 10:00:00 +0000',
        'Message-ID: <lunch@example.org>',
        '',
        'At noon?',
      ].join('\n'),
    )
    auth = new FakeOAuth(mail, { id: own.clientId, secret: own.clientSecret })
    clock = Date.UTC(2026, 10, 7, 12)
    secrets = new Map()
    answer = (asked) => ({
      code: `code-${auth.asked.length}`,
      state: asked.searchParams.get('state') ?? '',
    })
    service = {
      ...GOOGLE,
      authorize: 'https://accounts.example/authorize',
      token: 'https://accounts.example/token',
      imap: { host: '127.0.0.1', port: mail.imapPort, tls: 'none' },
      smtp: { host: '127.0.0.1', port: mail.smtpPort, tls: 'none' },
    }
    host = {
      secret: (name) => Promise.resolve(secrets.get(name) ?? null),
      keepSecret: (name, value) => {
        if (value === null) secrets.delete(name)
        else secrets.set(name, value)
        return Promise.resolve()
      },
      socket: nodeSocket,
      fetch: () => Promise.reject(new Error('no fetch here')),
      now: () => clock,
      authorize: (make) =>
        Promise.resolve(auth.authorize(make('http://127.0.0.1:49152'), (asked) => answer(asked))),
      post: (url, form) =>
        url === service.token
          ? auth.post(form)
          : Promise.resolve({ status: 404, body: 'not here' }),
    }
  })

  afterEach(async () => {
    await mail.close()
  })

  const vault = () => secretName('gmail', ADDRESS, 'refresh')

  test('signs in in the browser with PKCE, and keeps only the lasting token in the vault', async () => {
    const provider = oauthMailProvider(service)
    const connection = await provider.connect({ ...own, name: 'Emil' }, host)

    const asked = auth.asked[0]
    expect(`${asked?.origin ?? ''}${asked?.pathname ?? ''}`).toBe(
      'https://accounts.example/authorize',
    )
    expect(Object.fromEntries(asked?.searchParams ?? [])).toMatchObject({
      client_id: 'orden-desktop',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:49152',
      scope: 'https://mail.google.com/ openid email',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    })
    expect(asked?.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(asked?.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(auth.forms[0]).toMatchObject({
      grant_type: 'authorization_code',
      client_secret: 'not-really-secret',
    })
    expect(auth.forms[0]?.code_verifier).toMatch(/^[A-Za-z0-9_-]{64}$/)

    expect(connection.account).toMatchObject({
      id: ADDRESS,
      label: ADDRESS,
      keep: { address: ADDRESS },
    })
    expect([...secrets.entries()]).toEqual([[vault(), 'refresh-1']])
    expect(JSON.stringify(connection.account)).not.toContain('access-')
    expect(mail.bearers).toEqual(['access-1'])

    const conversations = await connection.conversations()
    expect(conversations.map((one) => one.title)).toEqual(['Lunch'])
    await connection.send('lunch@example.org', { text: 'Yes' })
    expect(mail.sent).toHaveLength(1)
    expect(mail.bearers).toEqual(['access-1', 'access-1'])
    await connection.close()
  })

  test('an answer to another sign-in, or a refusal, is not taken', async () => {
    answer = () => ({ code: 'code-1', state: 'someone else' })
    await expect(oauthMailProvider(service).connect(own, host)).rejects.toThrow(/not for this/)
    answer = (asked) => ({
      error: 'access_denied',
      error_description: 'The user said no',
      state: asked.searchParams.get('state') ?? '',
    })
    await expect(oauthMailProvider(service).connect(own, host)).rejects.toThrow(/said no/)
    expect(secrets.size).toBe(0)
    expect(auth.forms).toHaveLength(0)
  })

  test('a token about to run out is renewed before it is used', async () => {
    auth.rotate = true
    const connection = await oauthMailProvider(service).connect(own, host)
    clock += 3600_000 - 30_000
    await connection.send('lunch@example.org', { text: 'Later' })
    expect(auth.forms.map((one) => one.grant_type)).toEqual(['authorization_code', 'refresh_token'])
    expect(auth.forms[1]?.scope).toBeUndefined()
    expect(mail.bearers.at(-1)).toBe('access-2')
    expect([...secrets.entries()]).toEqual([[vault(), auth.refresh]])
    expect(auth.refresh).not.toBe('refresh-1')
    await connection.close()
  })

  test('a token the server no longer takes is renewed once, after its refusal is answered', async () => {
    const connection = await oauthMailProvider(service).connect(own, host)
    mail.tokens.clear()
    await connection.send('lunch@example.org', { text: 'Again' })
    expect(mail.sent).toHaveLength(1)
    expect(mail.bearers.slice(-2)).toEqual(['access-1', 'access-2'])

    mail.tokens.clear()
    let online: () => void = () => undefined
    const ready = new Promise<void>((resolve) => (online = resolve))
    const stop = connection.start((event) => {
      if (event.t === 'status' && event.status === 'online') online()
    })
    await ready
    expect(mail.bearers.slice(-2)).toEqual(['access-2', 'access-3'])
    stop()
    await connection.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(mail.bearers.at(-1)).toBe('access-3')

    mail.sasl = false
    const plain = await oauthMailProvider(service).connect({ ...own, address: ADDRESS }, host)
    expect(mail.bearers.at(-1)).toBe('access-4')
    await plain.close()
  })

  test('opened again later, it signs in with the kept token and no browser', async () => {
    const first = await oauthMailProvider(service).connect(own, host)
    await first.close()
    const opened = auth.asked.length
    const again = await oauthMailProvider(service).connect({ ...own, address: ADDRESS }, host)
    expect(auth.asked).toHaveLength(opened)
    expect(again.account.id).toBe(ADDRESS)
    expect(auth.forms.at(-1)).toMatchObject({
      grant_type: 'refresh_token',
      client_id: 'orden-desktop',
      client_secret: 'not-really-secret',
    })
    expect(mail.bearers.at(-1)).toBe('access-2')
    await again.close()
  })

  test('a lasting token that is refused signs out, forgets it, and asks to connect again', async () => {
    const connection = await oauthMailProvider(service).connect(own, host)
    const heard: ProviderEvent[] = []
    let out: () => void = () => undefined
    const signedOut = new Promise<void>((resolve) => (out = resolve))
    auth.refusing = true
    clock += 7200_000
    const stop = connection.start((event) => {
      heard.push(event)
      if (event.t === 'status' && event.status === 'signed-out') out()
    })
    await signedOut
    expect(heard.find((event) => event.t === 'status')).toMatchObject({
      status: 'signed-out',
      reason: expect.stringMatching(/connect the account again/),
    })
    expect(secrets.size).toBe(0)
    stop()
    await connection.close()

    await expect(
      oauthMailProvider(service).connect({ ...own, address: ADDRESS }, host),
    ).rejects.toThrow(/connect the account again/)
  })

  test('without your own client it cannot connect, says why, and opens no browser', async () => {
    const provider = oauthMailProvider(service)
    await expect(provider.connect({ name: 'Emil' }, host)).rejects.toThrow(
      'Gmail needs the client ID of your own OAuth client',
    )
    await expect(provider.connect({ clientId: '  ' }, host)).rejects.toThrow(/client ID/)
    await expect(provider.connect({ clientId: own.clientId }, host)).rejects.toThrow(
      'Gmail needs the client secret of your own OAuth client',
    )
    await expect(provider.connect({ address: ADDRESS }, host)).rejects.toThrow(/client ID/)
    expect(auth.asked).toEqual([])
    expect(secrets.size).toBe(0)
  })

  test('a client the service does not know is refused, and nothing is kept', async () => {
    await expect(
      oauthMailProvider(service).connect({ ...own, clientSecret: 'wrong' }, host),
    ).rejects.toThrow(/did not sign in/)
    expect(secrets.size).toBe(0)
  })

  test('a mailbox that refuses after signing in keeps nothing in the vault', async () => {
    mail.bearer = false
    await expect(oauthMailProvider(service).connect(own, host)).rejects.toThrow()
    expect(secrets.size).toBe(0)
  })

  test('an address the sign-in does not name is not guessed', async () => {
    auth.claims = { sub: '123' }
    await expect(oauthMailProvider(service).connect(own, host)).rejects.toThrow(/which address/)
    auth.claims = { preferred_username: ADDRESS }
    const connection = await oauthMailProvider(service).connect(own, host)
    expect(connection.account.id).toBe(ADDRESS)
    await connection.close()
  })

  test('Microsoft: a public client on localhost, its scopes asked again on renewal', async () => {
    const microsoft: OAuthService = {
      ...MICROSOFT,
      token: 'https://accounts.example/token',
      imap: service.imap,
      smtp: service.smtp,
    }
    service = microsoft
    auth = new FakeOAuth(mail, { id: 'orden-entra' })
    const connection = await oauthMailProvider(microsoft).connect({ clientId: 'orden-entra' }, host)
    const asked = auth.asked[0]
    expect(`${asked?.origin ?? ''}${asked?.pathname ?? ''}`).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    )
    expect(asked?.searchParams.get('redirect_uri')).toBe('http://localhost:49152')
    expect(asked?.searchParams.get('scope')).toBe(
      'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid email',
    )
    expect(auth.forms[0]?.client_secret).toBeUndefined()
    expect(auth.forms[0]?.redirect_uri).toBe('http://localhost:49152')
    clock += 3600_000
    await connection.send('lunch@example.org', { text: 'Ok' })
    expect(auth.forms[1]).toMatchObject({ grant_type: 'refresh_token', scope: microsoft.scope })
    expect([...secrets.keys()]).toEqual([secretName('microsoft', ADDRESS, 'refresh')])
    await connection.close()
  })
})

describe('the OAuth mail services', () => {
  const host: Host = {
    secret: () => Promise.resolve(null),
    keepSecret: () => Promise.resolve(),
    socket: nodeSocket,
    fetch: globalThis.fetch,
    now: () => 0,
    authorize: () => Promise.resolve({}),
  }

  test('are there wherever the app can sign in, with no client built in', () => {
    expect(gmailProvider.available(host)).toBe(true)
    expect(microsoftProvider.available(host)).toBe(true)
    const noBrowser: Host = { ...host }
    delete noBrowser.authorize
    expect(gmailProvider.available(noBrowser)).toBe(false)
    expect(microsoftProvider.available(noBrowser)).toBe(false)
  })

  test('ask for your own client, its secret only where the service needs one, and say how to make it', () => {
    expect(gmailProvider).toMatchObject({ id: 'gmail', name: 'Gmail', kept: ['refresh'] })
    expect(microsoftProvider).toMatchObject({ id: 'microsoft', name: 'Microsoft 365' })
    expect(gmailProvider.fields.map(({ help, ...field }) => ({ ...field, help: !!help }))).toEqual([
      { key: 'clientId', label: 'OAuth client ID', kind: 'text', help: true },
      {
        key: 'clientSecret',
        label: 'OAuth client secret',
        kind: 'password',
        secret: true,
        help: false,
      },
      { key: 'name', label: 'Your name', kind: 'text', optional: true, help: false },
    ])
    expect(microsoftProvider.fields.map((field) => [field.key, !!field.secret])).toEqual([
      ['clientId', false],
      ['name', false],
    ])
    expect(gmailProvider.fields[0]?.help?.url).toBe('https://console.cloud.google.com/auth/clients')
    expect(microsoftProvider.fields[0]?.help?.url).toMatch(/^https:\/\/entra\.microsoft\.com\//)
    expect(microsoftProvider.fields[0]?.help?.steps?.join(' ')).toContain('http://localhost')
    expect([GOOGLE.imap, GOOGLE.smtp]).toEqual([
      { host: 'imap.gmail.com', port: 993, tls: 'tls' },
      { host: 'smtp.gmail.com', port: 465, tls: 'tls' },
    ])
    expect([MICROSOFT.imap, MICROSOFT.smtp]).toEqual([
      { host: 'outlook.office365.com', port: 993, tls: 'tls' },
      { host: 'smtp.office365.com', port: 587, tls: 'starttls' },
    ])
  })

  test('a token is posted as a form where the host cannot post for it', async () => {
    let seen: { url: string; init: RequestInit | undefined } | null = null
    const posting: Host = {
      ...host,
      fetch: (url, init) => {
        seen = { url: url instanceof Request ? url.url : url.toString(), init }
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
        )
      },
      authorize: (make) => {
        const state = new URL(make('http://127.0.0.1:1')).searchParams.get('state') ?? ''
        return Promise.resolve({ code: 'a b', state })
      },
    }
    await expect(
      gmailProvider.connect({ clientId: 'id', clientSecret: 'shh' }, posting),
    ).rejects.toThrow(/invalid_grant/)
    const sent = seen as { url: string; init: RequestInit | undefined } | null
    expect(sent?.url).toBe('https://oauth2.googleapis.com/token')
    expect(sent?.init?.method).toBe('POST')
    expect(typeof sent?.init?.body === 'string' ? sent.init.body : '').toContain('code=a+b')
  })

  test('the claims of an id token are read, and a broken one reads as none', () => {
    expect(claimsOf(idToken({ email: 'é@example.org' }))).toEqual({ email: 'é@example.org' })
    expect(claimsOf('nope')).toEqual({})
    expect(claimsOf(undefined)).toEqual({})
    expect(claimsOf('a.!!!.c')).toEqual({})
  })

  test('the challenge is the SHA-256 of the verifier, as RFC 7636 shows', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})
