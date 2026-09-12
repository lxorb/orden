/** What readers typed into the forms on a site, for whoever published it.
 *
 *  A form is a fence in a note and an answer belongs to the note that asked, so
 *  this is read per space and grouped by note: which page was asking, what came
 *  back, and when. The owner's, like everything else about a site: a collaborator
 *  writes in the space, they did not put the form on the internet.
 *
 *  Two shapes of the same thing, because the app wants both: the rows, for the
 *  quiet list in the publish sheet, and a CSV, for the spreadsheet somebody
 *  actually works in. The CSV is written here rather than in the app so that what
 *  a column is called is decided once; see blog/form.ts. */

import { Hono } from 'hono'
import { asCsv } from '../blog/form'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** How many answers one read hands back. A form on a blog that has taken more
 *  than this wants the CSV, which is bounded by the same number. */
const MOST_SHOWN = 500

interface Row {
  id: string
  note_id: string
  path: string
  at: number
  answers: string
}

/** One row, as the app reads it. The answers are a JSON object keyed by the
 *  question the note asked; anything that is not that is dropped rather than
 *  handed on, because the column is written by this service and read by the app.
 */
function present(row: Row) {
  let answers: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(row.answers)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      answers = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) =>
          typeof value === 'string' ? [[key, value]] : [],
        ),
      )
    }
  } catch {
    // A row nobody can read says nothing, which is what an empty object is.
  }

  return { id: row.id, note: row.note_id, path: row.path, at: row.at, answers }
}

async function rowsFor(env: Env, spaceId: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `select a.id as id, a.note_id as note_id, n.path as path, a.at as at, a.answers as answers
       from form_answers a
       join notes n on n.id = a.note_id
      where a.space_id = ?
      order by a.at desc
      limit ?`,
  )
    .bind(spaceId, MOST_SHOWN)
    .all<Row>()

  return results
}

export const answers = new Hono<{ Bindings: Env; Variables: Variables }>()

/** Everything the forms on this site have collected, newest first. */
answers.get('/:id/answers', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const rows = await rowsFor(context.env, space.id)

  return context.json({
    answers: rows.map(present),
    more: rows.length === MOST_SHOWN,
  })
})

/** The same, as a file for a spreadsheet. */
answers.get('/:id/answers.csv', atLeast('owner'), async (context) => {
  const space = spaceOf(context)
  const rows = await rowsFor(context.env, space.id)

  const csv = asCsv(
    rows.map((row) => {
      const one = present(row)
      return { at: one.at, answers: { page: one.path, ...one.answers } }
    }),
  )

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="answers.csv"',
      'cache-control': 'private, no-store',
    },
  })
})

/** One answer, gone. Somebody's to delete: spam arrives, and a message that has
 *  been read and acted on is not something an account should hold for ever. */
answers.delete('/:id/answers/:answer', atLeast('owner'), async (context) => {
  const space = spaceOf(context)

  await context.env.DB.prepare('delete from form_answers where id = ? and space_id = ?')
    .bind(context.req.param('answer'), space.id)
    .run()

  return context.json({ ok: true })
})
