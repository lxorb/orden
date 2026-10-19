/** Which order a space's file list is read in (#423): one of the seven the app offers,
 *  or nothing, which is by name, the order every list starts in.
 *
 *  A word on the space rather than a choice each device keeps for itself: Emil, *"if I
 *  turn on manual for one space, it will remain on for that space even on other
 *  devices"*. The order the rows were arranged into by hand is `arranged`, next door;
 *  this says whether the list is read in it. */

import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody } from '../body'
import { writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** The orders a list may be read in, as the app writes them; see tree-order.ts there.
 *  `name` is the first of them, and is written as nothing. */
const SORTS = new Set([
  'name',
  'name-desc',
  'modified-desc',
  'modified-asc',
  'created-desc',
  'created-asc',
  'manual',
])

/** The column, as the app reads it back: an order this service knows, or `name`. A
 *  word written by a newer build that this one has never heard of reads as the first
 *  order rather than as something the app would have to guess at. */
export function readSort(raw: string): string {
  return SORTS.has(raw) ? raw : 'name'
}

export const spaceSort = new Hono<{ Bindings: Env; Variables: Variables }>()

// The space's rather than the reader's: everyone in it sees the same tree, so choosing
// how it is read is writing in the space, as arranging its rows is.
spaceSort.put('/:id/sort', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sort = body.sort
  if (typeof sort !== 'string' || !SORTS.has(sort)) {
    return context.json({ error: `sort is one of ${[...SORTS].join(', ')}` }, 400)
  }

  // The first order is written as nothing, which is what a space nobody chose for holds.
  await writeColumn(context.env, 'sort', space.id, sort === 'name' ? '' : sort)
  return context.json({ sort })
})
