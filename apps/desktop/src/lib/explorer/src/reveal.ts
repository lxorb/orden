import { listFolder } from './commands'
import { folderName, parentOf } from './crumbs'
import { openExplorer } from './open'
import { explorerPrefs } from './prefs.svelte'
import { viewOf } from './view.svelte'

export async function showInExplorer(path: string): Promise<boolean> {
  const folder = parentOf(path)
  if (folder === null) return false
  const listing = await listFolder(folder).catch(() => null)
  const name = folderName(path)
  const entry = listing?.entries.find((one) => one.name === name)
  if (!listing || !entry || (entry.hidden && !explorerPrefs.hidden)) return false
  viewOf(await openExplorer(listing.path)).pickOnArrival(name)
  return true
}
