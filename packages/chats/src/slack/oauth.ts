import { toBase64 } from '../mail/bytes'
import type { Host } from '../provider'
import { record, text } from './api'

export const CLIENT_ID = 'slackClientId'
export const SERVER = 'ordenServer'

const AUTHORIZE = 'https://slack.com/oauth/v2/authorize'

export const USER_SCOPES = [
  'channels:read',
  'channels:history',
  'channels:write',
  'channels:write.invites',
  'groups:read',
  'groups:history',
  'groups:write',
  'groups:write.invites',
  'im:read',
  'im:history',
  'im:write',
  'mpim:read',
  'mpim:history',
  'mpim:write',
  'chat:write',
  'files:read',
  'files:write',
  'reactions:read',
  'reactions:write',
  'pins:read',
  'pins:write',
  'users:read',
  'emoji:read',
  'search:read',
  'team:read',
]

export interface Granted {
  token: string
  team: string
  user: string
}

const urlSafe = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function signIn(host: Host): Promise<Granted> {
  const authorize = host.authorize
  const client = host.build?.[CLIENT_ID]
  const server = host.build?.[SERVER]?.replace(/\/+$/, '')
  if (!authorize || !client || !server)
    throw new Error('Paste a Slack user token, this build cannot sign in through the browser')
  const nonce = urlSafe(globalThis.crypto.getRandomValues(new Uint8Array(24)))
  let state = ''
  const said = await authorize((loopback) => {
    const port = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(loopback)?.[1]
    if (!port) throw new Error('Slack sign-in needs a local port')
    state = `${port}.${nonce}`
    const url = new URL(AUTHORIZE)
    url.searchParams.set('client_id', client)
    url.searchParams.set('user_scope', USER_SCOPES.join(','))
    url.searchParams.set('redirect_uri', `${server}/v1/slack/callback`)
    url.searchParams.set('state', state)
    return url.toString()
  })
  if (!state || said.state !== state) throw new Error('the sign-in answer was not for this sign-in')
  if (said.error) throw new Error(`Slack: ${said.error}`)
  if (!said.code) throw new Error('Slack gave no sign-in code')
  const answer = await host.fetch(`${server}/v1/slack/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: said.code }),
  })
  const body = record(await answer.json().catch(() => null))
  const granted = {
    token: text(body.token),
    team: text(body.team),
    user: text(body.user),
  }
  if (!answer.ok || !granted.token.startsWith('xoxp-'))
    throw new Error(`Slack did not sign in (${text(body.error) || `HTTP ${answer.status}`})`)
  return granted
}
