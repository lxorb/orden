/** A tab an agent names by its id, as `get_context` and `workspace_tabs` list them.
 *
 *  Every kind of tab is reached this way as well as by its path, so "the tab in front"
 *  is one id whatever it holds: a note with a file, a note with none yet, a canvas or
 *  page note drawn but never saved, a terminal. The tabs are
 *  the open space's - another space's are not in the window until the reader goes there
 *  - so an agent that may not reach that space has no tab to name. */

import type { Tab } from '../../workspace.svelte'
import { workspace } from '../../workspace.svelte'
import { within } from '../../space-paths'
import type { TabKind } from '../../workspace/documents.svelte'
import { type Call, maybe, need } from './call'
import { Refused } from './problem'
import { type Place, placeFor } from './spaces'

/** A tab, found: the tab itself, the space it is shown in, and its file's path inside
 *  that space - null for a tab with no file there (a draft, a terminal,
 *  the graph). */
interface Named {
  tab: Tab
  place: Place
  relative: string | null
}

/** The tab with this id among the reader's, or a refusal naming the list to ask. */
export function tabWithId(id: string): Tab {
  const found = workspace.tabs.find((one) => one.id === id)
  if (!found) throw new Refused('no_such_tab', `there is no tab ${id}: get_context lists them`)

  return found
}

/** The tab a call names under `tab`, of one of the kinds given. */
export function namedTab(call: Call, kinds: readonly TabKind[], what: string): Named {
  const place = placeFor(call, null)
  const tab = tabWithId(need(call, 'tab'))
  if (!kinds.includes(tab.kind)) {
    throw new Refused('bad_arguments', `tab ${tab.id} is a ${tab.kind} tab, not ${what}`)
  }

  // The space's own folder is no file of it: a tab's path is never that.
  const relative = tab.path === null ? null : within(place.space.root, tab.path)
  if (relative !== null && relative !== '') tabsOwnSpace(call, tab, place)
  return { tab, place, relative: relative === '' ? null : relative }
}

/** A tab's place stands: a `space` said beside the tab is refused unless it is the
 *  tab's own. The tab's path is read inside its own space, so the same path in the
 *  space said would be another note, never the tab's. */
export function tabsOwnSpace(call: Call, tab: Tab, place: Place): void {
  const said = maybe(call, 'space')
  if (said === null || placeFor(call, said).space.id === place.space.id) return

  throw new Refused(
    'bad_arguments',
    `tab ${tab.id} is in ${place.space.name}, not ${said}: name the tab alone`,
  )
}
