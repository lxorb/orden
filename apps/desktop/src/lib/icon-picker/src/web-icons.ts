import { chatOf } from '@orden/chats/pointer'
import { termOf } from '@orden/online/term'
import { isChatTarget, isTermTarget } from '@orden/markdown/links'
import { keptSitePicture } from '../../icons/src/api'
import { links } from '../../link-index/src/api'
import { insideSpace, samePath } from '../../platform/src/api'
import { ICON_KEY, siteOfIcon } from '../../ui-kit/src/api'
import { workspace } from '../../workspace/src/api'
import type { IconTarget } from './icon-choice.svelte'
import { putOn, wornBy } from './icon-target'

type Keep = (site: string) => Promise<string | null>
interface Worn {
  target: IconTarget
  site: string
  read: boolean
}
const keyOf = (target: IconTarget): string => {
  if (target.kind === 'space') return `space:${target.id}`
  if (target.kind === 'terminal') return `tab:${target.tab}`
  return target.kind === 'pass' ? 'pass' : `path:${target.path}`
}
function placesIn(root: string): IconTarget[] {
  const places: IconTarget[] = workspace.spaces.map((space) => ({ kind: 'space', id: space.id }))
  for (const at of Object.keys(workspace.folderIcons.of(root))) {
    places.push({ kind: 'folder', path: insideSpace(root, at) })
  }
  for (const [at, meta] of Object.entries(workspace.itemMeta.itemsOf(root))) {
    if (meta[ICON_KEY]) places.push({ kind: 'file', path: insideSpace(root, at) })
  }
  if (samePath(links.rootOf(), root)) {
    for (const note of links.held()) if (note.icon) places.push({ kind: 'file', path: insideSpace(root, note.path) })
  }
  for (const tab of workspace.tabs) if (tab.kind === 'terminal') places.push({ kind: 'terminal', tab: tab.id })
  return places
}
async function wornInFiles(root: string): Promise<Worn[]> {
  if (!samePath(links.rootOf(), root)) return []
  const found: Worn[] = []
  for (const at of links.index(null).files) {
    const chat = isChatTarget(at)
    if (!chat && !isTermTarget(at)) continue
    const path = insideSpace(root, at)
    const text = await workspace.noteText(path)
    if (text === null) continue
    const site = siteOfIcon(chat ? chatOf(text)?.icon : termOf(text)?.icon)
    if (site !== null) found.push({ target: { kind: 'file', path }, site, read: true })
  }
  return found
}
export async function keepWebIcons(root: string, keep: Keep = keptSitePicture): Promise<boolean> {
  const worn = new Map<string, Worn>()
  for (const target of placesIn(root)) {
    const site = siteOfIcon(wornBy(target))
    if (site !== null) worn.set(keyOf(target), { target, site, read: false })
  }
  for (const one of await wornInFiles(root)) worn.set(keyOf(one.target), one)
  const pictures = new Map<string, Promise<string | null>>()
  let left = false
  for (const { target, site, read } of worn.values()) {
    let picture = pictures.get(site)
    if (!picture) {
      picture = keep(site).catch(() => null)
      pictures.set(site, picture)
    }
    const kept = await picture
    if (kept === null) {
      left = true
      continue
    }
    if (read || siteOfIcon(wornBy(target)) === site) await putOn(target, kept, null)
  }
  return !left
}
const done = new Set<string>()
const going = new Set<string>()
export function sweepSpace(root: string): void {
  if (done.has(root) || going.has(root)) return
  void sweep(root)
}
async function sweep(root: string) {
  going.add(root)
  try {
    if (await keepWebIcons(root)) done.add(root)
  } finally {
    going.delete(root)
  }
}
