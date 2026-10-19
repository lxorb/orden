/** Send feedback (#548): what somebody wrote about a problem, with what the app adds -
 *  its version, the platform it runs on and the recent app log - and nothing of their
 *  notes.
 *
 *  `POST /v1/feedback`, open to anybody: a person who cannot sign in is often the one
 *  with something to report. A session, when the request carries one, says whose report
 *  it is; a guest's or a program's is not an account and counts as nobody. Each report
 *  is a row (0055) and, where `FEEDBACK_TO` names an address, a mail to it through the
 *  binding every other message goes out by.
 *
 *  Counted three ways, because the route writes a row and sends a mail for anybody who
 *  asks: per machine, per account, and on the service as a whole. */

import { Hono } from 'hono'
import { requireWhoever } from './auth'
import { readBody } from './body'
import { newId, now } from './crypto'
import { escape, mailer, oneLine } from './email'
import { machineOf, within } from './limits'
import { TRY_IN_AN_HOUR } from './refused'
import type { Env, Variables } from './types'

/** How long each part may be: a description is a few paragraphs, the log the tail the
 *  app sends, and the version and platform a few words each. */
const MOST = { text: 10_000, version: 64, platform: 120, log: 64 * 1024 } as const

const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR

/** What one machine and one account may send in an hour, and the service in a day:
 *  far more than a person reporting what went wrong, and far less than a script. */
const FROM_ONE_MACHINE = 10
const FROM_ONE_ACCOUNT = 10
const ALL_IN_A_DAY = 500

const EMPTY = 'say what happened'

export const feedback = new Hono<{ Bindings: Env; Variables: Variables }>()

feedback.post('/', async (context) => {
  const body = await readBody(context)
  const text = body.text('text', MOST.text)?.trim() ?? ''
  const version = body.text('version', MOST.version) ?? ''
  const platform = body.text('platform', MOST.platform) ?? ''
  const log = body.text('log', MOST.log) ?? ''
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!text) return context.json({ error: EMPTY }, 400)

  const who = await requireWhoever(context.env, context.req.header('authorization'))
  const user = who?.kind === 'user' ? who.user : null

  const env = context.env
  const machine = machineOf(context.req)
  const allowed =
    (machine === null ||
      (await within(env, 'feedback-from', machine, FROM_ONE_MACHINE, AN_HOUR))) &&
    (user === null || (await within(env, 'feedback-by', user.id, FROM_ONE_ACCOUNT, AN_HOUR))) &&
    (await within(env, 'feedback', 'all', ALL_IN_A_DAY, A_DAY))
  if (!allowed) return context.json({ error: TRY_IN_AN_HOUR }, 429)

  const id = newId()
  await env.DB.prepare(
    `insert into feedback (id, user_id, text, version, platform, log, created_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user?.id ?? null, text, version, platform, log, now())
    .run()

  if (env.FEEDBACK_TO) {
    const from = user ? user.email : 'somebody signed out'
    await mailer(env).send(
      env.FEEDBACK_TO,
      feedbackSubject(text),
      feedbackMail({ from, text, version, platform, log }),
    )
  }

  return context.json({ ok: true, id })
})

/** The subject: the report's first words, so a list of them reads as one. */
export function feedbackSubject(text: string): string {
  const first = oneLine(text)
  return `Orden feedback: ${first.length > 60 ? `${first.slice(0, 59)}…` : first}`
}

/** The mail: who sent it, the words, then what the app added. Every part came from a
 *  person or their machine, so none of it may become markup. */
export function feedbackMail(report: {
  from: string
  text: string
  version: string
  platform: string
  log: string
}): { text: string; html: string } {
  const about = `From ${report.from} · Orden ${report.version || 'unknown'} · ${report.platform || 'unknown'}`
  const log = report.log || '(no log)'
  return {
    text: `${about}\n\n${report.text}\n\n--- recent app log ---\n${log}\n`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1a1d23">
  <p style="color:#8a93a2">${escape(about)}</p>
  <p style="white-space:pre-wrap">${escape(report.text)}</p>
  <p style="color:#8a93a2;margin-top:22px">Recent app log</p>
  <pre style="font-size:12px;white-space:pre-wrap;color:#4a5160">${escape(log)}</pre>
</div>`,
  }
}
