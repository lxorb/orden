import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody } from '../body'
import { now } from '../crypto'
import { fits } from './columns'
import type { Env, Space, Variables } from '../types'
import { isCanvasTarget } from '@orden/markdown/links'
import { noteKind } from '../rooms/kind'
import { fillFronts } from '../site/fill'
import { readFront } from '../site/front'
import { readSpaceFiles } from './files'
import { hashPassword, newSiteKey } from '../site/gate'
import {
  folders,
  LONGEST_ICON,
  presentSite,
  publishes,
  readSite,
  type Site,
  type SiteRules,
  words,
  wrong,
} from '../site/site'
import { atLeast, presentSpace, spaceOf } from './space'

export const site = new Hono<{ Bindings: Env; Variables: Variables }>()

const SHOWN = 50
const MOST_LISTED = 2000

site.post('/:id/site/preview', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  await fillFronts(context.env, space.id).catch(() => 0)

  const held = readSite(space.site)
  const given = (sent.rules ?? {}) as Record<string, unknown>
  const asked: SiteRules = {
    include: folders(given.include),
    exclude: folders(given.exclude),
    otherwise: given.otherwise === 'none' ? 'none' : 'all',
  }

  const { results } = await context.env.DB.prepare(
    `select path, front, size, kind, epoch from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_LISTED)
    .all<{ path: string; front: string | null; size: number; kind: string; epoch: number }>()

  const adds: string[] = []
  const removes: string[] = []
  let after = 0
  let before = 0
  let bytes = 0

  for (const row of results) {
    if (isCanvasTarget(row.path) || noteKind(row) === 'plane') continue

    const front = readFront(row.front)
    const was = space.blog_enabled ? publishes(held.rules, row.path, front) : false
    const is = publishes(asked, row.path, front)

    if (was) before += 1
    if (is) {
      after += 1
      bytes += row.size
    }
    if (is && !was) adds.push(row.path)
    if (was && !is) removes.push(row.path)
  }

  const beside = readSpaceFiles(space.files).map((one) => one.path.toLowerCase())

  return context.json({
    pages: after,
    bytes,
    dressing: { css: beside.includes('publish.css'), js: beside.includes('publish.js') },
    before,
    adds: adds.slice(0, SHOWN),
    removes: removes.slice(0, SHOWN),
    more: adds.length > SHOWN || removes.length > SHOWN,
  })
})

site.put('/:id/site', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  await fillFronts(context.env, space.id).catch(() => 0)

  const held = readSite(space.site)
  const given = (sent.rules ?? {}) as Record<string, unknown>

  const kept: Site = {
    rules: {
      include: sent.rules === undefined ? held.rules.include : folders(given.include),
      exclude: sent.rules === undefined ? held.rules.exclude : folders(given.exclude),
      otherwise:
        sent.rules === undefined
          ? held.rules.otherwise
          : given.otherwise === 'none'
            ? 'none'
            : 'all',
    },
  }

  const description = sent.description === undefined ? held.description : words(sent.description)
  if (description) kept.description = description

  const image = sent.image === undefined ? held.image : words(sent.image, 500)
  if (image) kept.image = image

  const icon = sent.icon === undefined ? held.icon : words(sent.icon, LONGEST_ICON)
  if (icon?.startsWith('<svg')) kept.icon = icon

  if (sent.theme === undefined) {
    if (held.theme) kept.theme = held.theme
  } else if (sent.theme && typeof sent.theme === 'object') {
    const said = sent.theme as Record<string, unknown>
    const name = words(said.name)
    const hash = words(said.hash, 64)
    if (name && hash) kept.theme = { name, hash }
  }

  if (sent.analytics === undefined) {
    if (held.analytics) kept.analytics = held.analytics
  } else if (sent.analytics && typeof sent.analytics === 'object') {
    const said = sent.analytics as Record<string, unknown>
    const url = words(said.url, 400)
    const domain = words(said.domain)
    if (url) kept.analytics = { url, ...(domain ? { domain } : {}) }
  }

  if (sent.password === undefined) {
    if (held.password) kept.password = held.password
  } else if (typeof sent.password === 'string' && sent.password) {
    kept.password = { ...(await hashPassword(sent.password)), key: newSiteKey(), at: now() }
  }

  const written = JSON.stringify(kept)
  if (!fits(written, 'site')) {
    return context.json({ error: 'that is more than a site keeps' }, 413)
  }

  const at = now()
  await context.env.DB.prepare('update spaces set site = ?, updated_at = ? where id = ?')
    .bind(written, at, space.id)
    .run()

  const updated: Space = { ...space, site: written, updated_at: at }
  return context.json({ space: presentSpace(updated, context.env), site: presentSite(kept) })
})
