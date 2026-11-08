import type { AgentAnswer } from '../../automation/caller'
import { notePath } from '../../space-paths'
import { type Bookmark, MOST_BOOKMARKS, sameBookmark } from '../../workspace/bookmarks.svelte'
import { workspace } from '../../workspace.svelte'
import { asked } from './asks'
import { type Call, done, maybe, need } from './call'
import { Refused } from './problem'
import { judged, type Place, placeOf } from './spaces'
import { entryIn } from './tree'

async function bookmarkOf(call: Call, place: Place): Promise<Bookmark> {
  const query = maybe(call, 'query')
  if (query !== null) return { kind: 'search', path: '', text: query }

  const path = judged(need(call, 'path'))
  const heading = maybe(call, 'heading')
  if (heading !== null) {
    const note = notePath(path)
    if (note === null) throw new Refused('bad_arguments', `${path} is not a markdown note`)
    return { kind: 'heading', path: note, text: heading }
  }

  const entry = await entryIn(place, path)
  if (!entry) throw new Refused('no_such_file', `there is nothing at ${path}`)

  return { kind: entry.is_dir ? 'folder' : 'note', path, text: '' }
}

function shown(mark: Bookmark) {
  return {
    kind: mark.kind,
    path: mark.path,
    text: mark.text,
    ...(mark.parent ? { group: mark.parent } : {}),
  }
}

export async function bookmarks(call: Call): Promise<AgentAnswer> {
  const place = placeOf(call)
  const root = place.space.root
  const held = workspace.bookmarks.of(root)

  switch (need(call, 'op')) {
    case 'list':
      return done(held.map(shown))

    case 'add': {
      const mark = await bookmarkOf(call, place)
      const kept = (now: readonly Bookmark[]) => {
        if (now.some((one) => sameBookmark(one, mark))) return true
        if (now.length >= MOST_BOOKMARKS) {
          throw new Refused('failed', `a space keeps at most ${MOST_BOOKMARKS} bookmarks`)
        }
        return false
      }
      if (kept(workspace.bookmarks.of(root))) return done({ ...shown(mark), added: false })

      const question = await asked(call, null, `Bookmark ${mark.text || mark.path}`)
      if (question) return question

      const now = workspace.bookmarks.of(root)
      if (kept(now)) return done({ ...shown(mark), added: false })
      workspace.bookmarks.put(root, [...now, mark])
      return done({ ...shown(mark), added: true })
    }

    case 'remove': {
      const mark = await bookmarkOf(call, place).catch(() => null)
      const found =
        held.find((one) => mark !== null && sameBookmark(one, mark)) ??
        held.find(
          (one) =>
            one.kind !== 'group' &&
            ((one.path !== '' && one.path === maybe(call, 'path')) ||
              (one.kind === 'search' && one.text === maybe(call, 'query'))),
        )
      if (!found) return done({ removed: false })

      const question = await asked(call, null, `Take the bookmark ${found.text || found.path} away`)
      if (question) return question

      workspace.bookmarks.remove(found, root)
      return done({ ...shown(found), removed: true })
    }

    default:
      throw new Refused('bad_arguments', 'op is one of list, add, remove')
  }
}
