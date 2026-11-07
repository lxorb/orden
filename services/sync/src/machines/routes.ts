import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { readBody } from '../body'
import { askHub } from '../hub/reach'
import { newId, now } from '../crypto'
import { reachedItem, reachedSpace } from '../spaces/space'
import type { Env, Variables } from '../types'
import { askMachine } from './ask'
import { audit } from './audit'
import { NOT_FOUND } from './door'
import { whyNotWake } from './gate'
import { mayMakeSession, mayStart } from './limits'
import { ALLOWANCE, type HostKind, resetAt } from '@orden/online'
import { usedOf } from './meter'
import { MOST_SESSIONS, type Refusal, type SessionNow } from '@orden/online/wire'
import { allowed, serviceOf } from './service'

interface Online {
  Bindings: Env
  Variables: Variables
}

export const online = new Hono<Online>()

const on: MiddlewareHandler<Online> = async (context, next) => {
  if (!(await serviceOf(context.env)).on) return context.json({ error: NOT_FOUND }, 404)
  await next()
}
online.use('*', on)

interface MachineRow {
  id: string
  user_id: string
  state: string
  created_at: number
  woke_at: number | null
  slept_at: number | null
  home_bytes: number
  backup_at: number | null
  held: string | null
  host: HostKind
  size: string
  region: string
  spec: string | null
  price_month: number | null
  price_currency: string | null
  server_id: number | null
  disk_used: number
  disk_total: number
}

async function machineOf(env: Env, userId: string): Promise<MachineRow | null> {
  return await env.DB.prepare(
    `select id, user_id, state, created_at, woke_at, slept_at, home_bytes, backup_at, held,
            host, size, region, spec, price_month, price_currency, server_id, disk_used, disk_total
       from machines where user_id = ?`,
  )
    .bind(userId)
    .first<MachineRow>()
}

async function ensureMachine(env: Env, userId: string): Promise<MachineRow> {
  const had = await machineOf(env, userId)
  if (had) return had
  const id = `m_${newId().replaceAll('-', '')}`
  await env.DB.prepare(
    `insert into machines (id, user_id, created_at, host) values (?, ?, ?, 'hetzner')
     on conflict(user_id) do nothing`,
  )
    .bind(id, userId, now())
    .run()
  const made = await machineOf(env, userId)
  if (!made) throw new Error('the machine was not made')
  if (made.id === id) await audit(env, id, 'made', { who: userId })
  return made
}

const asked = (machine: MachineRow) => ({ 'x-orden-user': machine.user_id })

function serverOf(machine: MachineRow) {
  if (machine.server_id === null || !machine.spec) return null
  let spec: unknown
  try {
    spec = JSON.parse(machine.spec)
  } catch {
    return null
  }
  const { cores, memory, disk } = (spec ?? {}) as Record<string, unknown>
  if (typeof cores !== 'number' || typeof memory !== 'number' || typeof disk !== 'number') {
    return null
  }
  return {
    type: machine.size,
    location: machine.region,
    cores,
    memoryGb: memory,
    diskGb: disk,
    price: machine.price_month,
    currency: machine.price_currency,
  }
}

const refused = (error: Refusal) => ({ error })

online.get('/machine', async (context) => {
  const user = context.get('user')
  const at = now()
  const machine = await machineOf(context.env, user.id)
  return context.json({
    allowed: await allowed(context.env, user.id),
    machine: machine && {
      id: machine.id,
      state: machine.state,
      held: machine.held !== null,
      createdAt: machine.created_at,
      wokeAt: machine.woke_at,
      sleptAt: machine.slept_at,
      homeBytes: machine.home_bytes,
      backupAt: machine.backup_at,
      host: machine.host,
      server: serverOf(machine),
      disk: machine.disk_total > 0 ? { used: machine.disk_used, total: machine.disk_total } : null,
    },
    used: await usedOf(context.env, user.id, at),
    limit: ALLOWANCE,
    resetAt: resetAt(at),
  })
})

online.post('/machine/start', async (context) => {
  const user = context.get('user')
  const refusal = await whyNotWake(context.env, user.id, now())
  if (refusal) return context.json(refused(refusal), refusal === 'list' ? 403 : 409)
  if (!(await mayStart(context.env, user.id))) return context.json(refused('rate'), 429)

  const machine = await ensureMachine(context.env, user.id)
  await audit(context.env, machine.id, 'start', { who: user.id })
  const answer = await askMachine(context.env, machine.id, 'start', asked(machine))
  return context.json({
    state: answer ? (await answer.json<{ state: string }>()).state : 'asleep',
  })
})

online.post('/machine/stop', async (context) => {
  const user = context.get('user')
  const machine = await machineOf(context.env, user.id)
  if (!machine) return context.json({ error: NOT_FOUND }, 404)
  if (machine.host === 'hetzner') {
    const answer = await askMachine(context.env, machine.id, 'restart', {
      ...asked(machine),
      'x-orden-who': user.id,
    })
    return context.json({
      state: answer ? (await answer.json<{ state: string }>()).state : machine.state,
    })
  }
  await audit(context.env, machine.id, 'stop', { who: user.id, detail: 'stopped' })
  await askMachine(context.env, machine.id, 'stop', {
    ...asked(machine),
    'x-orden-reason': 'stopped',
  })
  return context.json({ state: 'asleep' })
})

online.post('/terms', async (context) => {
  const env = context.env
  const user = context.get('user')
  const who = context.get('who')
  const body = await readBody(context)
  const term = body.text('term', 200)
  const named = body.text('session', 200)
  if (body.problem) return context.json({ error: body.problem }, 400)

  if (!(await allowed(env, user.id))) return context.json(refused('list'), 403)
  if (!term) return await makeSession(context, env, user.id, null)

  const file = await env.DB.prepare('select id, space_id from notes where id = ? and deleted = 0')
    .bind(term)
    .first<{ id: string; space_id: string }>()
  const reached = file
    ? ((await reachedSpace(env, who, file.space_id)) ?? (await reachedItem(env, who, file)))
    : null
  if (!file || !reached) return context.json({ error: NOT_FOUND }, 404)
  if (reached.role === 'read') return context.json(refused('role'), 403)

  const adopted = named ? await adopt(env, user.id, term, named) : null
  if (adopted) return context.json(adopted)

  const had = await env.DB.prepare(
    'select machine, session, user_id, ended_at from term_sessions where term = ?',
  )
    .bind(term)
    .first<{ machine: string; session: string; user_id: string; ended_at: number | null }>()
  if (had?.user_id === user.id && had.ended_at === null) {
    return context.json({ v: 1, machine: had.machine, session: had.session })
  }
  if (had) return context.json(refused('gone'), 409)

  if (named && (await adoptable(env, user.id, named))) {
    return context.json(refused('gone'), 409)
  }

  return await makeSession(context, env, user.id, term)
})

async function adoptable(env: Env, userId: string, session: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `select 1 as one from term_sessions t
      where t.session = ?1 and t.user_id != ?2 and t.ended_at is null
        and not exists (select 1 from notes n
                         where n.id = t.term and t.term <> t.session and n.deleted = 0)`,
  )
    .bind(session, userId)
    .first<{ one: number }>()
  return row !== null
}

async function adopt(env: Env, userId: string, term: string, session: string) {
  const row = await env.DB.prepare(
    `update term_sessions set term = ?1
      where session = ?2 and user_id = ?3 and ended_at is null and term != ?1
        and not exists (
          select 1 from notes n
           where n.id = term_sessions.term and term_sessions.term <> term_sessions.session
             and n.deleted = 0
        )
        and not exists (select 1 from term_sessions t where t.term = ?1)
     returning machine, session`,
  )
    .bind(term, session, userId)
    .first<{ machine: string; session: string }>()
  return row && { v: 1, machine: row.machine, session: row.session }
}

async function makeSession(
  context: Context<Online>,
  env: Env,
  userId: string,
  term: string | null,
): Promise<Response> {
  const machine = await ensureMachine(env, userId)
  const { results: live } = await env.DB.prepare(
    'select term from term_sessions where machine = ? and ended_at is null order by created_at',
  )
    .bind(machine.id)
    .all<{ term: string }>()
  if (live.length >= MOST_SESSIONS) {
    return context.json({ ...refused('sessions'), sessions: live.map((one) => one.term) }, 409)
  }
  if (!(await mayMakeSession(env, userId))) return context.json(refused('rate'), 429)

  const session = `s_${newId().replaceAll('-', '')}`
  await env.DB.prepare(
    `insert into term_sessions (term, machine, session, user_id, created_at)
     values (?, ?, ?, ?, ?)`,
  )
    .bind(term ?? session, machine.id, session, userId, now())
    .run()
  await audit(env, machine.id, 'session', { who: userId })
  await askHub(env, userId, 'terms')
  return context.json({ v: 1, machine: machine.id, session })
}

async function machineSessions(env: Env, userId: string): Promise<Map<string, SessionNow> | null> {
  const machine = await machineOf(env, userId)
  if (!machine) return null
  const answer = await askMachine(env, machine.id, 'sessions', { 'x-orden-user': userId })
  const said = answer?.ok ? await answer.json<{ sessions: SessionNow[] | null }>() : null
  return said?.sessions ? new Map(said.sessions.map((one) => [one.session, one])) : null
}

online.get('/terms', async (context) => {
  const user = context.get('user')
  const running = machineSessions(context.env, user.id)
  const { results } = await context.env.DB.prepare(
    `select t.term as term, t.session as session, t.typing as typing,
            t.created_at as created_at, n.space_id as space, n.path as path, n.deleted as deleted
       from term_sessions t left join notes n on n.id = t.term and t.term <> t.session
      where t.user_id = ? and t.ended_at is null order by t.created_at`,
  )
    .bind(user.id)
    .all<{
      term: string
      session: string
      typing: string
      created_at: number
      space: string | null
      path: string | null
      deleted: number | null
    }>()
  const there = await running
  const named = new Set(results.map((one) => one.session))
  const nowOf = (session: string) => {
    const said = there?.get(session)
    return {
      program: said?.program ?? null,
      title: said?.title ?? null,
      alive: there ? (said?.alive ?? false) : null,
      at: said?.at ?? null,
    }
  }
  const unnamed = [...(there?.values() ?? [])].filter((one) => !named.has(one.session))
  return context.json({
    terms: [
      ...results.map((one) => ({
        term: one.term,
        session: one.session,
        typing: one.typing,
        createdAt: one.created_at,
        space: one.space,
        path: one.path,
        trashed: one.deleted === 1,
        ...nowOf(one.session),
      })),
      ...unnamed.map((one) => ({
        term: null,
        session: one.session,
        typing: 'owner',
        createdAt: null,
        space: null,
        path: null,
        trashed: false,
        ...nowOf(one.session),
      })),
    ],
  })
})

async function ownSession(env: Env, userId: string, term: string) {
  return await env.DB.prepare(
    `select t.machine as machine, t.session as session, t.user_id as user_id
       from term_sessions t where t.term = ? and t.user_id = ? and t.ended_at is null`,
  )
    .bind(term, userId)
    .first<{ machine: string; session: string; user_id: string }>()
}

online.patch('/terms/:term', async (context) => {
  const user = context.get('user')
  const term = context.req.param('term')
  const body = await readBody(context)
  const typing = body.text('typing', 10)
  if (body.problem || (typing !== 'owner' && typing !== 'writers')) {
    return context.json({ error: 'typing is owner or writers' }, 400)
  }
  const own = await ownSession(context.env, user.id, term)
  if (!own) return context.json({ error: NOT_FOUND }, 404)

  await context.env.DB.prepare('update term_sessions set typing = ? where term = ?')
    .bind(typing, term)
    .run()
  await audit(context.env, own.machine, 'typing', { who: user.id, detail: typing })
  await askMachine(context.env, own.machine, 'typing', {
    'x-orden-user': user.id,
    'x-orden-term': term,
    'x-orden-typing': typing,
  })
  return context.json({ typing })
})

const SESSION_ID = /^s_[A-Za-z0-9]{1,64}$/

online.delete('/terms/:term', async (context) => {
  const user = context.get('user')
  const term = context.req.param('term')
  const own = await ownSession(context.env, user.id, term)
  if (!own) {
    const machine = SESSION_ID.test(term) ? await machineOf(context.env, user.id) : null
    if (!machine) return context.json({ error: NOT_FOUND }, 404)
    await context.env.DB.prepare(
      'update term_sessions set ended_at = ? where session = ? and user_id = ? and ended_at is null',
    )
      .bind(now(), term, user.id)
      .run()
    await audit(context.env, machine.id, 'ended', { who: user.id })
    await askMachine(context.env, machine.id, 'end', {
      'x-orden-user': user.id,
      'x-orden-session': term,
    })
    await askHub(context.env, user.id, 'terms')
    return context.json({ ok: true })
  }

  await context.env.DB.prepare('update term_sessions set ended_at = ? where term = ?')
    .bind(now(), term)
    .run()
  await audit(context.env, own.machine, 'ended', { who: user.id })
  await askMachine(context.env, own.machine, 'end', {
    'x-orden-user': user.id,
    'x-orden-session': own.session,
  })
  await askHub(context.env, user.id, 'terms')
  return context.json({ ok: true })
})

online.get('/events', async (context) => {
  const user = context.get('user')
  const machine = await machineOf(context.env, user.id)
  if (!machine) return context.json({ events: [] })
  const { results } = await context.env.DB.prepare(
    `select at, kind, who, device, detail from machine_events
      where machine = ? order by at desc, id desc limit 200`,
  )
    .bind(machine.id)
    .all()
  return context.json({ events: results })
})
