import type { Tab } from '../../workspace.svelte'
import { within } from '../../platform/src/api'
import type { TabKind } from '../../workspace/documents.svelte'
import { type Call, maybe, need } from './call'
import { Refused } from './problem'
import { type Place, placeFor, tabsInReach } from './spaces'

interface Named {
  tab: Tab
  place: Place
  relative: string | null
}

export function tabWithId(call: Call, id: string): Tab {
  const found = tabsInReach(call).find((one) => one.id === id)
  if (!found) throw new Refused('no_such_tab', `there is no tab ${id}: get_context lists them`)

  return found
}

export function namedTab(call: Call, kinds: readonly TabKind[], what: string): Named {
  const place = placeFor(call, null)
  const tab = tabWithId(call, need(call, 'tab'))
  if (!kinds.includes(tab.kind)) {
    throw new Refused('bad_arguments', `tab ${tab.id} is a ${tab.kind} tab, not ${what}`)
  }

  const relative = tab.path === null ? null : within(place.space.root, tab.path)
  if (relative !== null && relative !== '') tabsOwnSpace(call, tab, place)
  return { tab, place, relative: relative === '' ? null : relative }
}

export function tabsOwnSpace(call: Call, tab: Tab, place: Place): void {
  const said = maybe(call, 'space')
  if (said === null || placeFor(call, said).space.id === place.space.id) return

  throw new Refused(
    'bad_arguments',
    `tab ${tab.id} is in ${place.space.name}, not ${said}: name the tab alone`,
  )
}
