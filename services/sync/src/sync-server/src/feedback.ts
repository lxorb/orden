import { Hono } from 'hono'
import { readBody } from './body'
import { equals, newId, now, randomToken, sha256 } from './crypto'
import { escape, mailer, oneLine } from './email'
import { MOST_DATA_URL, MOST_IMAGES, type Picture, pictureKey, pictureOf } from './feedback-images'
import { imagesOf, issueState, openIssue } from './feedback-issues'
import { reportPage } from './feedback-page'
import { hooks } from './hooks'
import { machineOf, within } from './limits'
import { TRY_IN_AN_HOUR } from './refused'
import type { Env, Variables } from './types'

const MOST = { text: 10_000, version: 64, platform: 120, log: 64 * 1024 } as const

const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR

const FROM_ONE_MACHINE = 10
const FROM_ONE_ACCOUNT = 10
const ALL_IN_A_DAY = 500

const PICTURED_IN_A_DAY = 200

const EMPTY = 'say what happened'

export const feedback = new Hono<{ Bindings: Env; Variables: Variables }>()

feedback.post('/', async (context) => {
  const body = await readBody(context)
  const text = body.text('text', MOST.text)?.trim() ?? ''
  const version = body.text('version', MOST.version) ?? ''
  const platform = body.text('platform', MOST.platform) ?? ''
  const log = body.text('log', MOST.log) ?? ''
  const sent = body.texts('images', MOST_IMAGES, MOST_DATA_URL) ?? []
  if (body.problem) return context.json({ error: body.problem }, 400)
  if (!text) return context.json({ error: EMPTY }, 400)

  const pictures: Picture[] = []
  for (const one of sent) {
    const picture = pictureOf(one)
    if (typeof picture === 'string') return context.json({ error: picture }, 400)
    pictures.push(picture)
  }

  const who = await hooks().accounts.whoever(context.env, context.req.header('authorization'))
  const user = who?.kind === 'user' ? who.user : null

  const env = context.env
  const machine = machineOf(context.req)
  const allowed =
    (machine === null ||
      (await within(env, 'feedback-from', machine, FROM_ONE_MACHINE, AN_HOUR))) &&
    (user === null || (await within(env, 'feedback-by', user.id, FROM_ONE_ACCOUNT, AN_HOUR))) &&
    (await within(env, 'feedback', 'all', ALL_IN_A_DAY, A_DAY)) &&
    (!pictures.length || (await within(env, 'feedback-pictured', 'all', PICTURED_IN_A_DAY, A_DAY)))
  if (!allowed) return context.json({ error: TRY_IN_AN_HOUR }, 429)

  const id = newId()
  const at = now()
  const key = randomToken()

  const names = pictures.map(() => randomToken())
  for (const [index, picture] of pictures.entries()) {
    await env.NOTES.put(pictureKey(id, names[index] ?? ''), picture.bytes, {
      httpMetadata: { contentType: picture.type },
    })
  }

  await env.DB.batch([
    env.DB.prepare(
      `insert into feedback (id, user_id, text, version, platform, log, created_at, status_hash)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, user?.id ?? null, text, version, platform, log, at, await sha256(key)),
    ...pictures.map((picture, index) =>
      env.DB.prepare(
        `insert into feedback_images (name, feedback_id, position, type, size, created_at)
           values (?, ?, ?, ?, ?, ?)`,
      ).bind(names[index] ?? '', id, index, picture.type, picture.bytes.length, at),
    ),
  ])

  const issue = openIssue(env, id)
  try {
    context.executionCtx.waitUntil(issue)
  } catch {
    await issue
  }

  if (env.FEEDBACK_TO) {
    const from = user ? user.email : 'somebody signed out'
    await mailer(env).send(
      env.FEEDBACK_TO,
      feedbackSubject(text),
      feedbackMail({ from, text, version, platform, log }),
    )
  }

  return context.json({ ok: true, id, url: pageUrl(env, id, key) })
})

function pageUrl(env: Env, id: string, key: string): string {
  return `${env.APP_ORIGIN}/v1/feedback/${id}/${key}`
}

feedback.get('/images/:name', async (context) => {
  const name = context.req.param('name')
  if (!/^[0-9a-f]{64}$/.test(name)) return context.notFound()
  const row = await context.env.DB.prepare(
    'select feedback_id, type from feedback_images where name = ?',
  )
    .bind(name)
    .first<{ feedback_id: string; type: string }>()
  if (!row) return context.notFound()
  const object = await context.env.NOTES.get(pictureKey(row.feedback_id, name))
  if (!object) return context.notFound()
  return new Response(object.body, {
    headers: {
      'content-type': row.type,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  })
})

feedback.get('/:id/:key', async (context) => {
  const { id, key } = context.req.param()
  const env = context.env
  const row = /^[0-9a-f]{64}$/.test(key)
    ? await env.DB.prepare(
        'select text, created_at, issue_number, status_hash from feedback where id = ?',
      )
        .bind(id)
        .first<{
          text: string
          created_at: number
          issue_number: number | null
          status_hash: string | null
        }>()
    : null
  const found = !!row?.status_hash && equals(row.status_hash, await sha256(key))
  const html =
    row && found
      ? reportPage({
          text: row.text,
          sentAt: row.created_at,
          filed: row.issue_number !== null,
          state: row.issue_number === null ? null : await issueState(env, row.issue_number),
          images: await imagesOf(env, id),
        })
      : reportPage(null)
  return context.html(html, found ? 200 : 404, {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex',
    'content-security-policy': `default-src 'none'; img-src ${new URL(env.APP_ORIGIN).origin}; style-src 'unsafe-inline'`,
  })
})

export function feedbackSubject(text: string): string {
  const first = oneLine(text)
  return `Orden feedback: ${first.length > 60 ? `${first.slice(0, 59)}…` : first}`
}

export function feedbackMail(report: {
  from: string
  text: string
  version: string
  platform: string
  log: string
}): { text: string; html: string } {
  const about = `From ${report.from}, Orden ${report.version || 'unknown'}, ${report.platform || 'unknown'}`
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
