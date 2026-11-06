import { type Context, Hono } from 'hono'
import { sendCode, verifyCode } from '../auth'
import { WRONG_CODE } from '../refused'
import { accepted, asksForSecond, halfWay, spendHalf, whoseHalf } from '../second'
import { normaliseEmail, now, randomToken, sha256 } from '../crypto'
import { machineOf } from '../limits'
import type { Env } from '../types'
import { type Client, clientFor, clientWasUsed } from './clients'
import { codeStep, emailStep, page, refusal, secondStep } from './consent'
import {
  type Ask,
  askFrom,
  challengeLooksRight,
  failure,
  issuer,
  resourceMatches,
  resourceUrl,
  textFields,
  tooLong,
  unknownScopes,
  wantsWrite,
} from './protocol'
import { sameRedirect } from './redirects'

const CODE_TTL = 10 * 60 * 1000

const MOST_CLIENTS_AN_ACCOUNT = 20
const MOST_CONNECTIONS = 200

export const authorize = new Hono<{ Bindings: Env }>()

async function roomToConnect(env: Env, userId: string, clientId: string): Promise<boolean> {
  const held = await env.DB.prepare(
    `select count(*) as connections,
            count(distinct client_id) as clients,
            sum(case when client_id = ?2 then 1 else 0 end) as ours
       from oauth_grants where user_id = ?1`,
  )
    .bind(userId, clientId)
    .first<{ connections: number; clients: number; ours: number | null }>()

  if ((held?.connections ?? 0) >= MOST_CONNECTIONS) return false
  if ((held?.clients ?? 0) < MOST_CLIENTS_AN_ACCOUNT) return true

  return !!held?.ours
}

function backToClient(env: Env, at: string, ask: Ask, params: Record<string, string>): Response {
  let url: URL
  try {
    url = new URL(ask.redirect_uri)
  } catch {
    return page(env, refusal('That app gave an address this server cannot use.'), 400)
  }

  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (ask.state) url.searchParams.set('state', ask.state)
  url.searchParams.set('iss', issuer(env, at))

  return new Response(null, { status: 302, headers: { location: url.toString() } })
}

async function checkClient(env: Env, ask: Ask): Promise<{ client: Client } | { problem: string }> {
  const long = tooLong(ask)
  if (long) return { problem: `The ${long.replace(/_/g, ' ')} in this request is too long.` }

  const client = await clientFor(env, ask.client_id)
  if (!client) return { problem: 'This app is not known here. Add the connector again in the app.' }

  if (
    !ask.redirect_uri ||
    !client.redirectUris.some((one) => sameRedirect(one, ask.redirect_uri))
  ) {
    return { problem: `${client.name} asked to be sent somewhere it did not register.` }
  }

  return { client }
}

function checkRequest(
  env: Env,
  at: string,
  ask: Ask,
  query: Record<string, string | undefined>,
): Record<string, string> | null {
  if (query.response_type !== 'code') {
    return failure('unsupported_response_type', 'only the code flow is supported')
  }
  if (
    !challengeLooksRight(ask.code_challenge) ||
    (query.code_challenge_method ?? 'S256') !== 'S256'
  ) {
    return failure('invalid_request', 'PKCE with S256 is required')
  }
  if (!resourceMatches(env, ask.resource)) {
    return failure('invalid_target', `this server is ${resourceUrl(env, at)}`)
  }
  const unknown = unknownScopes(ask.scope)
  if (unknown.length) return failure('invalid_scope', `unknown scope ${unknown[0]}`)

  return null
}

authorize.get('/authorize', async (context) => {
  const query = context.req.query()
  const ask = askFrom(query)

  const checked = await checkClient(context.env, ask)
  if ('problem' in checked) return page(context.env, refusal(checked.problem), 400)

  const problem = checkRequest(context.env, context.req.url, ask, query)
  if (problem) return backToClient(context.env, context.req.url, ask, problem)

  return page(context.env, emailStep(checked.client, ask, {}))
})

async function formOf(
  context: Context<{ Bindings: Env }>,
): Promise<Record<string, string | undefined>> {
  return textFields(await context.req.parseBody().catch(() => ({})))
}

authorize.post('/authorize', async (context) => {
  const form = await formOf(context)
  const ask = askFrom(form)

  const checked = await checkClient(context.env, ask)
  if ('problem' in checked) return page(context.env, refusal(checked.problem), 400)
  const { client } = checked

  if (
    !challengeLooksRight(ask.code_challenge) ||
    !resourceMatches(context.env, ask.resource) ||
    unknownScopes(ask.scope).length
  ) {
    return page(
      context.env,
      refusal('This request is not complete. Start again from the app.'),
      400,
    )
  }

  const email = normaliseEmail(form.email ?? '')

  if (form.action === 'deny') {
    return backToClient(
      context.env,
      context.req.url,
      ask,
      failure('access_denied', 'the person said no'),
    )
  }

  if (form.action === 'send') {
    const sent = await sendCode(context.env, email, machineOf(context.req))
    if ('error' in sent) {
      return page(context.env, emailStep(client, ask, { email, error: sent.error }))
    }
    return page(context.env, codeStep(client, ask, { email }))
  }

  if (form.action === 'allow') {
    const verified = await verifyCode(
      context.env,
      email,
      form.code ?? '',
      context.req.header('accept-language'),
    )
    if ('error' in verified) {
      return page(context.env, codeStep(client, ask, { email, error: verified.error }))
    }

    if (await asksForSecond(context.env, verified.user.id)) {
      const holding = await halfWay(context.env, verified.user)
      return page(context.env, secondStep(ask, { holding, write: form.write === '1' }))
    }

    return await grant(context, client, ask, verified.user.id, form.write === '1')
  }

  if (form.action === 'second') {
    const holding = form.holding ?? ''
    const whose =
      holding && holding.length <= HOLDING_LIMIT ? await whoseHalf(context.env, holding) : null
    if (!whose)
      return page(context.env, refusal('That took too long. Start again from the app.'), 400)

    const write = form.write === '1'
    if (!(await accepted(context.env, whose, form.code ?? '', machineOf(context.req)))) {
      return page(context.env, secondStep(ask, { holding, write, error: WRONG_CODE }))
    }

    await spendHalf(context.env, holding)
    return await grant(context, client, ask, whose, write)
  }

  return page(context.env, refusal('That is not something this page does.'), 400)
})

const HOLDING_LIMIT = 128

async function grant(
  context: Context<{ Bindings: Env }>,
  client: Client,
  ask: Ask,
  userId: string,
  write: boolean,
): Promise<Response> {
  if (!(await roomToConnect(context.env, userId, client.id))) {
    return page(
      context.env,
      refusal('That is as many apps as one account connects. Disconnect one in Orden first.'),
      409,
    )
  }

  const readOnly = !(wantsWrite(ask) && write)
  const code = randomToken()

  await context.env.DB.prepare('delete from oauth_codes where expires_at < ?').bind(now()).run()

  await context.env.DB.prepare(
    `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, read_only, expires_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await sha256(code),
      client.id,
      userId,
      ask.redirect_uri,
      ask.code_challenge,
      readOnly ? 1 : 0,
      now() + CODE_TTL,
    )
    .run()

  await clientWasUsed(context.env, client.id)

  return backToClient(context.env, context.req.url, ask, { code })
}
