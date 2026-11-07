import { Hono } from 'hono'
import { objectBody } from './body'
import { machineOf, maySignInToSlack } from './limits'
import type { Env } from './types'

const ACCESS = 'https://slack.com/api/oauth.v2.access'
const STATE = /^(\d{1,5})\.([A-Za-z0-9_-]{16,64})$/
const CODE = /^[A-Za-z0-9._-]{8,256}$/
const ERROR = /^[a-z_]{1,64}$/

const PAGE = (said: string) =>
  `<!doctype html><meta charset=utf-8><title>Orden</title><p style="font:16px system-ui;margin:3em;text-align:center">${said}</p>`

export const slack = new Hono<{ Bindings: Env }>()

function noStore(headers: Headers): void {
  headers.set('cache-control', 'no-store')
  headers.set('referrer-policy', 'no-referrer')
}

function callbackOf(env: Env): string {
  return `${env.APP_ORIGIN.replace(/\/+$/, '')}/v1/slack/callback`
}

slack.get('/callback', (context) => {
  const state = context.req.query('state') ?? ''
  const matched = STATE.exec(state)
  const port = Number(matched?.[1] ?? 0)
  if (!matched || port < 1024 || port > 65535) {
    const page = context.html(PAGE('This Slack sign-in was not started by Orden.'), 400)
    noStore(page.headers)
    return page
  }
  const back = new URL(`http://127.0.0.1:${port}/`)
  back.searchParams.set('state', state)
  const code = context.req.query('code') ?? ''
  const error = context.req.query('error') ?? ''
  if (CODE.test(code)) back.searchParams.set('code', code)
  else back.searchParams.set('error', ERROR.test(error) ? error : 'no_code')
  const answer = context.redirect(back.toString(), 302)
  noStore(answer.headers)
  return answer
})

slack.post('/token', async (context) => {
  const env = context.env
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET)
    return context.json({ error: 'slack_not_set_up' }, 503)
  if (!(await maySignInToSlack(env, machineOf(context.req))))
    return context.json({ error: 'too_many_tries' }, 429)
  const sent = await objectBody(context)
  const code = typeof sent?.code === 'string' ? sent.code : ''
  if (!CODE.test(code)) return context.json({ error: 'no_code' }, 400)
  let said: Record<string, unknown> = {}
  try {
    const answer = await fetch(ACCESS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID,
        client_secret: env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: callbackOf(env),
      }).toString(),
    })
    const parsed: unknown = await answer.json()
    if (typeof parsed === 'object' && parsed !== null) said = parsed as Record<string, unknown>
  } catch {
    return context.json({ error: 'slack_unreachable' }, 502)
  }
  const user = (said.authed_user ?? {}) as Record<string, unknown>
  const team = (said.team ?? {}) as Record<string, unknown>
  const token = typeof user.access_token === 'string' ? user.access_token : ''
  if (said.ok !== true || !token.startsWith('xoxp-')) {
    const error = typeof said.error === 'string' && ERROR.test(said.error) ? said.error : 'refused'
    return context.json({ error }, 400)
  }
  const answer = context.json({
    token,
    user: typeof user.id === 'string' ? user.id : '',
    team: typeof team.id === 'string' ? team.id : '',
    scope: typeof user.scope === 'string' ? user.scope : '',
  })
  noStore(answer.headers)
  return answer
})
