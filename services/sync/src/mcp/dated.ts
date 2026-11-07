import { rowsOfText } from '@orden/bases/rows'
import {
  type Arrived,
  datesChanged,
  inOldFolder,
  isTodoList,
  MARKED_KEY,
  MARKED_VALUE,
  type Meta,
  OLD_FOLDER,
} from '@orden/bases/todo-lists'
import { metaFromText } from '@orden/sync-core/meta'
import { pokeNow } from '../hub/poke'
import { describeById } from '../sync2/ops'
import { prepareSpace } from '../sync2/prepare'
import type { Env, Note } from '../types'

interface Lists {
  listed: (path: string, meta: Meta) => boolean
  home: string
}

const DEEPEST = 64

export async function listsBy(env: Env, spaceId: string): Promise<Lists> {
  const { results } = await env.DB.prepare(
    `with recursive up(meta, parent, path, depth) as (
       select meta, parent_id, name, 0 from folders
        where space_id = ?1 and deleted = 0 and meta like ?2
       union all
       select up.meta, f.parent_id, f.name || '/' || up.path, up.depth + 1
         from up join folders f on f.id = up.parent
        where f.space_id = ?1 and f.deleted = 0 and up.depth < ?3
     )
     select meta, path from up where parent is null`,
  )
    .bind(spaceId, `%${MARKED_KEY}%`, DEEPEST)
    .all<{ meta: string | null; path: string }>()
  const marked = results
    .filter((one) => metaFromText(one.meta)?.[MARKED_KEY] === MARKED_VALUE)
    .map((one) => one.path)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
  return {
    listed: (path, meta) => isTodoList(path, meta) || inOldFolder(path, meta, marked.length > 0),
    home: marked[0] ?? OLD_FOLDER,
  }
}

export function dated(
  env: Env,
  space: { id: string; name: string },
  path: string,
  before: string,
  after: string,
  note: Pick<Note, 'id' | 'meta'>,
  today: string,
  arrived?: Arrived,
): Promise<void> {
  return dating(env, space, path, before, after, note, today, arrived).catch(() => undefined)
}

async function dating(
  env: Env,
  space: { id: string; name: string },
  path: string,
  before: string,
  after: string,
  note: Pick<Note, 'id' | 'meta'>,
  today: string,
  arrived?: Arrived,
): Promise<void> {
  const meta = metaFromText(note.meta)
  if (!(await listsBy(env, space.id)).listed(path, meta)) return
  const rows = (text: string) => rowsOfText(space.name, path, text)
  const patch = datesChanged(rows(before), rows(after), meta, today, arrived)
  if (!patch) return
  const held = await env.DB.prepare('select prepared_at from spaces where id = ?')
    .bind(space.id)
    .first<{ prepared_at: number | null }>()
  if (!held?.prepared_at) await prepareSpace(env, space.id)
  const done = await describeById(env, space.id, undefined, note.id, patch)
  if (done.changed) await pokeNow(env, space.id, done.cursor)
}
