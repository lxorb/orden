import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { listIn, objectBody } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'
import { deviceOf } from '../sync2/device'
import { v1Wrote } from '../sync2/maps'

const MOST = 60
const LONGEST_TEXT = 200

const KINDS = ['note', 'folder', 'heading', 'search', 'block', 'group', 'graph'] as const
type Kind = (typeof KINDS)[number]

const LONGEST_PARENT = 100

const LONGEST_VIEW = 400

export interface Bookmark {
  kind: Kind
  path: string
  text: string
  parent?: string
  view?: string
  id?: string
}

const LONGEST_ID = 64

export function bookmarkId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID ? value : null
}

function wrong(value: unknown): string | null {
  if (!Array.isArray(value)) return 'bookmarks must be a list'
  if (value.length > MOST) return `bookmarks holds at most ${MOST} entries`

  for (const one of value) {
    if (!one || typeof one !== 'object' || Array.isArray(one)) return 'a bookmark must be an object'

    const { kind, path, text } = one as Record<string, unknown>
    if (!KINDS.some((known) => known === kind)) return 'a bookmark must say what kind it is'
    if (typeof path !== 'string' || path.length > LONGEST_PATH) {
      return `a bookmark's path must be text of at most ${LONGEST_PATH} characters`
    }
    if (typeof text !== 'string' || text.length > LONGEST_TEXT) {
      return `a bookmark's text must be text of at most ${LONGEST_TEXT} characters`
    }

    const { parent, view } = one as Record<string, unknown>
    if (parent !== undefined && (typeof parent !== 'string' || parent.length > LONGEST_PARENT)) {
      return `a bookmark's group must be text of at most ${LONGEST_PARENT} characters`
    }
    if (view !== undefined && (typeof view !== 'string' || view.length > LONGEST_VIEW)) {
      return `a bookmarked view must be text of at most ${LONGEST_VIEW} characters`
    }
    if (!staysInside(path)) return 'a bookmark points inside its own space'
  }

  return null
}

export function readBookmarks(raw: string): Bookmark[] {
  const held = listIn(raw)
  if (!held) return []

  return held.filter((one): one is Bookmark => wrong([one]) === null).slice(0, MOST)
}

export const bookmarks = new Hono<{ Bindings: Env; Variables: Variables }>()

bookmarks.put('/:id/bookmarks', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.bookmarks
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  const kept = (sent as Bookmark[]).map(({ kind, path, text, parent, view, id }) => {
    const entry = bookmarkId(id)
    return {
      kind,
      path,
      text,
      ...(parent ? { parent } : {}),
      ...(view ? { view } : {}),
      ...(entry ? { id: entry } : {}),
    }
  })
  const written = JSON.stringify(kept)
  if (!fits(written, 'bookmarks')) {
    return context.json({ error: 'that is more bookmarks than a space holds' }, 413)
  }

  await writeColumn(context.env, 'bookmarks', space.id, written)
  await v1Wrote(context.env, space, 'bookmark', kept, await deviceOf(context))

  return context.json({ bookmarks: kept })
})
