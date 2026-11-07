import type { ChatProvider, ConnectField, ConnectHelp, Host, Posted, SocketAsk } from '../provider'
import { secretName } from '../provider'
import { fromBase64, toBase64 } from './bytes'
import { type Bearer, linkedMail, SignedOut } from './provider'

const EARLY = 60_000

export interface OAuthService {
  id: string
  name: string
  icon: string
  authorize: string
  token: string
  scope: string
  secret: boolean
  help: ConnectHelp
  renewScope?: boolean
  extra: Readonly<Record<string, string>>
  imap: SocketAsk
  smtp: SocketAsk
  loopback(given: string): string
}

export const GOOGLE: OAuthService = {
  id: 'gmail',
  name: 'Gmail',
  icon: 'M3 7.5V18a1 1 0 0 0 1 1h3v-8.5l5 3.75 5-3.75V19h3a1 1 0 0 0 1-1V7.5a1.5 1.5 0 0 0-2.4-1.2L12 11 5.4 6.3A1.5 1.5 0 0 0 3 7.5z',
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  scope: 'https://mail.google.com/ openid email',
  secret: true,
  help: {
    url: 'https://console.cloud.google.com/auth/clients',
    label: 'How to make your own Google client',
    steps: [
      'In Google Cloud, create a project, then set up the consent screen as External and add your address as a test user',
      'Under Clients, create a client of type Desktop app and paste its ID and secret here',
      'Testing apps are signed out after 7 days; set the app to In production to stay signed in',
      'Simpler: connect Email with an app password from your Google account instead',
    ],
  },
  extra: { access_type: 'offline', prompt: 'consent' },
  imap: { host: 'imap.gmail.com', port: 993, tls: 'tls' },
  smtp: { host: 'smtp.gmail.com', port: 465, tls: 'tls' },
  loopback: (given) => given,
}

export const MICROSOFT: OAuthService = {
  id: 'microsoft',
  name: 'Microsoft 365',
  icon: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scope:
    'https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access openid email',
  secret: false,
  help: {
    url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    label: 'How to make your own Microsoft app',
    steps: [
      'In Microsoft Entra, register an app for accounts in any directory and personal Microsoft accounts',
      'Under Authentication, add Mobile and desktop applications with the redirect URI http://localhost and allow public client flows',
      'Under API permissions, add the delegated permissions IMAP.AccessAsUser.All, SMTP.Send and offline_access, then paste the Application (client) ID here',
    ],
  },
  renewScope: true,
  extra: { prompt: 'select_account' },
  imap: { host: 'outlook.office365.com', port: 993, tls: 'tls' },
  smtp: { host: 'smtp.office365.com', port: 587, tls: 'starttls' },
  loopback: (given) => given.replace('//127.0.0.1:', '//localhost:'),
}

interface Client {
  id: string
  secret?: string
}

interface Tokens {
  access: string
  until: number
  refresh?: string
  id?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const urlSafe = (bytes: Uint8Array): string =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function random(count: number): string {
  return urlSafe(globalThis.crypto.getRandomValues(new Uint8Array(count)))
}

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return urlSafe(new Uint8Array(digest))
}

export function claimsOf(token: string | undefined): Record<string, unknown> {
  const part = token?.split('.')[1]
  if (!part) return {}
  try {
    const parsed: unknown = JSON.parse(
      new TextDecoder().decode(fromBase64(part.replace(/-/g, '+').replace(/_/g, '/'))),
    )
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function addressOf(claims: Record<string, unknown>): string | null {
  for (const key of ['email', 'preferred_username', 'upn']) {
    const value = claims[key]
    if (typeof value === 'string' && /^[^@\s]+@[^@\s]+$/.test(value)) return value
  }
  return null
}

async function posted(
  host: Host,
  url: string,
  form: Readonly<Record<string, string>>,
): Promise<Posted> {
  if (host.post) return host.post(url, form)
  const answer = await host.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  })
  return { status: answer.status, body: await answer.text() }
}

async function exchange(
  host: Host,
  service: OAuthService,
  client: Client,
  form: Readonly<Record<string, string>>,
  renewing: boolean,
): Promise<Tokens> {
  const sent = await posted(host, service.token, {
    ...form,
    client_id: client.id,
    ...(client.secret ? { client_secret: client.secret } : {}),
  })
  let body: unknown
  try {
    body = JSON.parse(sent.body)
  } catch {
    body = null
  }
  const said = isRecord(body) ? body : {}
  const ok = sent.status >= 200 && sent.status < 300
  if (!ok || typeof said.access_token !== 'string' || !said.access_token) {
    const code = typeof said.error === 'string' ? said.error : `HTTP ${sent.status}`
    if (renewing && (sent.status === 400 || sent.status === 401)) {
      throw new SignedOut(`${service.name} ended the sign-in (${code}), connect the account again`)
    }
    throw new Error(`${service.name} did not sign in (${code})`)
  }
  const lasts = typeof said.expires_in === 'number' ? said.expires_in : Number(said.expires_in)
  return {
    access: said.access_token,
    until: host.now() + (Number.isFinite(lasts) && lasts > 0 ? lasts : 3600) * 1000,
    ...(typeof said.refresh_token === 'string' ? { refresh: said.refresh_token } : {}),
    ...(typeof said.id_token === 'string' ? { id: said.id_token } : {}),
  }
}

class Session implements Bearer {
  private access: { token: string; until: number } | null
  private renewing: Promise<string> | null = null

  constructor(
    private readonly service: OAuthService,
    private readonly client: Client,
    private readonly host: Host,
    private readonly vault: string,
    private refresh: string,
    first?: Tokens,
  ) {
    this.access = first ? { token: first.access, until: first.until } : null
  }

  fresh(force: boolean): Promise<string> {
    const held = this.access
    if (!force && held && held.until - EARLY > this.host.now()) return Promise.resolve(held.token)
    this.renewing ??= this.renew().finally(() => (this.renewing = null))
    return this.renewing
  }

  private async renew(): Promise<string> {
    let got: Tokens
    try {
      got = await exchange(
        this.host,
        this.service,
        this.client,
        {
          grant_type: 'refresh_token',
          refresh_token: this.refresh,
          ...(this.service.renewScope ? { scope: this.service.scope } : {}),
        },
        true,
      )
    } catch (error) {
      if (error instanceof SignedOut) {
        this.access = null
        await this.host.keepSecret(this.vault, null).catch(() => undefined)
      }
      throw error
    }
    this.access = { token: got.access, until: got.until }
    if (got.refresh && got.refresh !== this.refresh) {
      this.refresh = got.refresh
      await this.host.keepSecret(this.vault, got.refresh)
    }
    return got.access
  }
}

function clientOf(service: OAuthService, values: Readonly<Record<string, string>>): Client {
  const id = (values.clientId ?? '').trim()
  if (!id) throw new Error(`${service.name} needs the client ID of your own OAuth client`)
  const secret = (values.clientSecret ?? '').trim()
  if (service.secret && !secret)
    throw new Error(`${service.name} needs the client secret of your own OAuth client`)
  return { id, ...(secret ? { secret } : {}) }
}

function fieldsOf(service: OAuthService): ConnectField[] {
  return [
    { key: 'clientId', label: 'OAuth client ID', kind: 'text', help: service.help },
    ...(service.secret
      ? [
          {
            key: 'clientSecret',
            label: 'OAuth client secret',
            kind: 'password',
            secret: true,
          } satisfies ConnectField,
        ]
      : []),
    { key: 'name', label: 'Your name', kind: 'text', optional: true },
  ]
}

async function signIn(
  service: OAuthService,
  client: Client,
  host: Host,
): Promise<{ address: string; tokens: Tokens }> {
  const authorize = host.authorize
  if (!authorize) throw new Error('signing in needs the desktop app')
  const verifier = random(48)
  const state = random(24)
  const challenge = await challengeOf(verifier)
  let redirect = ''
  const said = await authorize((loopback) => {
    redirect = service.loopback(loopback)
    const url = new URL(service.authorize)
    const asked: Record<string, string> = {
      client_id: client.id,
      response_type: 'code',
      redirect_uri: redirect,
      scope: service.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...service.extra,
    }
    for (const [key, value] of Object.entries(asked)) url.searchParams.set(key, value)
    return url.toString()
  })
  if (said.state !== state) throw new Error('the sign-in answer was not for this sign-in')
  if (said.error) throw new Error(`${service.name}: ${said.error_description ?? said.error}`)
  if (!said.code || !redirect) throw new Error(`${service.name} gave no sign-in code`)
  const tokens = await exchange(
    host,
    service,
    client,
    {
      grant_type: 'authorization_code',
      code: said.code,
      redirect_uri: redirect,
      code_verifier: verifier,
    },
    false,
  )
  const address = addressOf(claimsOf(tokens.id))
  if (!address) throw new Error(`${service.name} did not say which address signed in`)
  return { address, tokens }
}

export function oauthMailProvider(service: OAuthService): ChatProvider {
  return {
    id: service.id,
    name: service.name,
    icon: service.icon,
    fields: fieldsOf(service),
    can: { send: true, attachments: true, live: true, replies: false },
    kept: ['refresh'],
    available: (host) => !!host.socket && !!host.authorize,
    async connect(values, host) {
      const open = host.socket
      if (!open) throw new Error('mail needs the desktop app')
      const client = clientOf(service, values)
      const name = (values.name ?? '').trim()
      const known = (values.address ?? '').trim()
      let address = known
      let session: Session
      let vault: string
      if (known) {
        vault = secretName(service.id, known.toLowerCase(), 'refresh')
        const refresh = await host.secret(vault)
        if (!refresh)
          throw new SignedOut(`signed out of ${service.name}, connect the account again`)
        session = new Session(service, client, host, vault, refresh)
      } else {
        const got = await signIn(service, client, host)
        if (!got.tokens.refresh) throw new Error(`${service.name} gave no lasting sign-in`)
        address = got.address
        vault = secretName(service.id, address.toLowerCase(), 'refresh')
        await host.keepSecret(vault, got.tokens.refresh)
        session = new Session(service, client, host, vault, got.tokens.refresh, got.tokens)
      }
      const config = {
        address,
        name,
        user: address,
        password: '',
        imap: service.imap,
        smtp: service.smtp,
        bearer: session,
      }
      try {
        return await linkedMail(config, host, open, { address })
      } catch (error) {
        if (!known) await host.keepSecret(vault, null).catch(() => undefined)
        throw error
      }
    },
  }
}

export const gmailProvider = oauthMailProvider(GOOGLE)

export const microsoftProvider = oauthMailProvider(MICROSOFT)
