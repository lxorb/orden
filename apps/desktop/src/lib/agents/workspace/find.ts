import type { AgentAnswer } from '../../automation/caller'
import type { Hit } from '@orden/scan/search/match'
import { parseQuery } from '@orden/scan/search/query'
import { searchSpace } from '../../search/space'
import { notePath, relativeTo } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import { type Call, count, done, maybe, need } from './call'
import { indexOf } from './links'
import { judged, onDisk, type Place, placeFor, placeOf, reachable, sharedSource } from './spaces'

const MATCHES = 50
const MOST_MATCHES = 500
const LONGEST = 200

interface Row {
  space: string
  path: string
  line: number
  text: string
}

function rowOf(place: Place, hit: Hit): Row {
  return {
    space: place.space.name,
    path: relativeTo(place.space.root, hit.path),
    line: hit.line + 1,
    text: hit.text.trim().slice(0, LONGEST),
  }
}

async function hitsIn(place: Place, query: string, most: number): Promise<Row[]> {
  const found: Row[] = []
  const root = place.space.root

  await searchSpace(
    root,
    parseQuery(query),
    [],
    most,
    (batch) => {
      for (const hit of batch.hits) if (found.length < most) found.push(rowOf(place, hit))
    },
    workspace.leftOutOf(root),
  )

  return found
}

export async function searchNotes(call: Call): Promise<AgentAnswer> {
  const query = need(call, 'query')
  const named = maybe(call, 'space')
  const most = count(call, 'limit', MATCHES, MOST_MATCHES)

  const places =
    named === null
      ? reachable(call).map((space) => ({ space, open: space.id === workspace.activeSpace?.id }))
      : [placeFor(call, named)]

  const rows: Row[] = []
  let marked: string | null = null
  for (const place of places) {
    if (rows.length >= most) break

    const found = await hitsIn(place, query, most - rows.length)
    rows.push(...found)
    if (found.length) marked ??= sharedSource(place)
  }

  return done(rows, marked)
}

export async function listBacklinks(call: Call): Promise<AgentAnswer> {
  const place = placeOf(call)
  const asked = judged(need(call, 'path'))
  const relative = notePath(asked) ?? asked

  const index = await indexOf(place)
  const rows = index.backlinks(onDisk(place, relative)).map((one) => ({
    path: one.path,
    line: one.line + 1,
    text: one.text.trim().slice(0, LONGEST),
  }))

  return done(rows, rows.length ? sharedSource(place) : null)
}
