import { noteBody, type Space, spacesFor } from '../mcp/tools'
import { shutFor, type Env } from '../../../sync-server/src/api'
export interface Found {
  note: string
  line: number
  text: string
}

const HITS = 20

const MOST_READ = 300

const MOST_NOTES = 1000

const MOST_LINE = 200

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

function named(path: string): string {
  return path.replace(MARKDOWN, '')
}

async function pathsIn(env: Env, space: Space): Promise<{ id: string; path: string }[]> {
  const { results } = await env.DB.prepare(
    `select id, path from notes where space_id = ? and deleted = 0 and kind != 'file'
      order by path limit ?`,
  )
    .bind(space.id, MOST_NOTES)
    .all<{ id: string; path: string }>()

  return results
}

export async function searchNotes(env: Env, userId: string, query: string): Promise<Found[]> {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const out: Found[] = []
  let read = 0

  const shut = await shutFor(env, userId)
  for (const space of await spacesFor(env, userId)) {
    if (out.length >= HITS || read >= MOST_READ) break

    for (const row of await pathsIn(env, space)) {
      if (out.length >= HITS || read >= MOST_READ) break
      if (shut(space.id, row.path)) continue
      read++

      const body = await noteBody(env, space.id, row.id)
      const lines = body.split('\n')
      for (let at = 0; at < lines.length; at++) {
        const line = lines[at] ?? ''
        if (!line.toLowerCase().includes(needle)) continue

        out.push({ note: named(row.path), line: at + 1, text: line.trim().slice(0, MOST_LINE) })
        break
      }
    }
  }

  return out
}

export async function readNote(env: Env, userId: string, name: string): Promise<string | null> {
  const wanted = named(name.trim()).toLowerCase()
  if (!wanted) return null

  const shut = await shutFor(env, userId)
  for (const space of await spacesFor(env, userId)) {
    for (const row of await pathsIn(env, space)) {
      if (named(row.path).toLowerCase() !== wanted || shut(space.id, row.path)) continue
      return noteBody(env, space.id, row.id)
    }
  }

  return null
}
