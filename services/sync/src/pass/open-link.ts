import type { LinkOpened } from '@orden/pass/wire'
import { type Context, Hono } from 'hono'
import { now } from '../crypto'
import { machineOf, within } from '../limits'
import { TRY_IN_AN_HOUR } from '../refused'
import type { Env } from '../types'
import { LINK_GONE, NO_SUCH_LINK } from './refusals'

const AN_HOUR = 60 * 60 * 1000
const OPENS_FROM_ONE_MACHINE = 300

const PRIVATE = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
} as const

export const openLink = new Hono<{ Bindings: Env }>()

function answer(context: Context<{ Bindings: Env }>, body: object, status: 200 | 404 | 410 | 429) {
  return context.json(body, status, PRIVATE)
}

openLink.get('/:id', async (context) => {
  const machine = machineOf(context.req)
  if (
    machine &&
    !(await within(context.env, 'pass-link', machine, OPENS_FROM_ONE_MACHINE, AN_HOUR))
  ) {
    return answer(context, { error: TRY_IN_AN_HOUR }, 429)
  }

  const id = context.req.param('id')
  const db = context.env.DB
  const opened = await db
    .prepare(
      `update pass_links set views = views + 1
        where id = ? and expires_at > ? and body <> '' and held_at is null
          and (max_views is null or views < max_views)
       returning body, expires_at, max_views, views`,
    )
    .bind(id, now())
    .first<{ body: string; expires_at: number; max_views: number | null; views: number }>()

  if (!opened) {
    const there = await db.prepare('select 1 as one from pass_links where id = ?').bind(id).first()
    return there
      ? answer(context, { error: LINK_GONE }, 410)
      : answer(context, { error: NO_SUCH_LINK }, 404)
  }

  if (opened.max_views !== null && opened.views >= opened.max_views) {
    await db.prepare(`update pass_links set body = '' where id = ?`).bind(id).run()
  }

  const read: LinkOpened = {
    body: opened.body,
    expires: opened.expires_at,
    left: opened.max_views === null ? null : opened.max_views - opened.views,
  }
  return answer(context, read, 200)
})
