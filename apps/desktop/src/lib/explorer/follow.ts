import { workspace } from '../workspace.svelte'
import { folderName } from './crumbs'
import { pins } from './pins.svelte'
import { readSpec, specMoved, writeSpec } from './spec'

const followers = new Set<() => void>()

export function onMoved(follower: () => void): () => void {
  followers.add(follower)
  return () => followers.delete(follower)
}

export function moved(from: string, to: string): void {
  pins.moved(from, to)
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'explorer') continue
    const spec = readSpec(tab.doc)
    const now = spec && specMoved(spec, from, to)
    if (!now) continue
    tab.name = folderName(now.folder)
    tab.note.replace(writeSpec(now), false)
    workspace.scheduleSession()
  }
  for (const follower of followers) follower()
}
