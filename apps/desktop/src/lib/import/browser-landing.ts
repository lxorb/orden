/** A browser's profile brought in as a space of its own: its open tabs, its pinned ones
 *  as the Essentials, its tab groups as folders and its bookmarks in a folder of their
 *  own, read by the browser's reader and written the way Zen's spaces are
 *  (sidebar-plan.ts, sidebar-landing.ts). Importing again brings only what is new.
 *
 *  The space is named for the browser, and for the profile too where the browser keeps
 *  several, so two profiles are two spaces and a profile imported twice is one. */

import { key, t } from '../i18n.svelte'
import type { Space } from '../workspace.svelte'
import { BROWSER_NAMES, browserFile, type BrowserId, type BrowserProfile } from './browsers'
import { type FolderWords, firefoxSidebar } from './firefox'
import { unmozLz4 } from './mozlz4'
import type { Lost } from './plan'
import type { Sidebar } from './sidebar'
import { landSpaces } from './sidebar-landing'
import { sidebarImport } from './sidebar-plan'
import { invoke } from '../tauri'

/** What a browser's profile came to: its sidebar, and what could not come with it. */
interface Read {
  sidebar: Sidebar
  lost: Lost[]
}

const CONTAINERS: Record<BrowserId, Lost> = {
  firefox: { text: key('Containers stay in Firefox') },
}

/** The profile written into its space; `several` where the browser keeps more than
 *  one profile. Answers the space, to land in. */
export async function landBrowser(profile: BrowserProfile, several: boolean): Promise<Space> {
  const browser = BROWSER_NAMES[profile.browser]
  const name = several ? `${browser} · ${profile.name}` : browser
  const read = await readFirefox(profile, name)
  const nothing = t('Nothing could be read out of {browser}.', { browser })
  if (!read) throw new Error(nothing)

  const { spaces, lost } = sidebarImport(read.sidebar, new Date(), CONTAINERS[profile.browser])
  return landSpaces(spaces, [...lost, ...read.lost], nothing)
}

/** The names of the folders the import makes, in the reader's language. */
function folderWords(): FolderWords {
  return {
    bookmarks: t('Bookmarks'),
    savedGroups: t('Saved groups'),
    group: t('Tab group'),
    toolbar: t('Bookmarks toolbar'),
    menu: t('Bookmarks menu'),
    other: t('Other bookmarks'),
    mobile: t('Mobile bookmarks'),
  }
}

/** Firefox's session, the first of its files that reads, and its bookmarks: out of
 *  `places.sqlite` where the crate could copy it, else its newest daily copy. Null
 *  where neither is there. */
async function readFirefox(profile: BrowserProfile, name: string): Promise<Read | null> {
  let session: unknown = null
  for (const file of profile.files.filter((one) => one.includes('sessionstore'))) {
    session = mozJson(await browserFile(profile, file))
    if (session) break
  }

  let bookmarks: unknown = null
  if (profile.files.includes('places.sqlite')) {
    bookmarks = await invoke<string>('read_firefox_places', { profile: profile.path })
      .then((said) => JSON.parse(said) as unknown)
      .catch(() => null)
  }
  const backup = profile.files.find((one) => one.startsWith('bookmarkbackups/'))
  if (!bookmarks && backup) bookmarks = mozJson(await browserFile(profile, backup))

  if (!session && !bookmarks) return null
  return { sidebar: firefoxSidebar(session, bookmarks, name, folderWords()), lost: [] }
}

/** What a `.jsonlz4` holds, or null for one that is not whole. */
function mozJson(bytes: Uint8Array | null): unknown {
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(unmozLz4(bytes))) as unknown
  } catch {
    return null
  }
}
