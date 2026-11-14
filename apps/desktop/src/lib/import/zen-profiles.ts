import { fromBase64, invoke, isDesktop } from '../platform/src/api'
import { unmozLz4 } from './mozlz4'
import { type BrowserEngine, mozillaEngine } from './search-engines'
import type { FolderWords } from './sidebar-made'
import { readZenSession, withBookmarks, type ZenPlaces, type ZenSession } from './zen'

export interface ZenProfile {
  name: string
  path: string
  files: string[]
}

export async function zenProfiles(): Promise<ZenProfile[]> {
  if (!isDesktop) return []
  try {
    return await invoke<ZenProfile[]>('zen_profiles')
  } catch {
    return []
  }
}

export interface ZenRead {
  sidebar: ZenSession
  engine: BrowserEngine | null
}

const SEARCH = 'search.json.mozlz4'

export async function zenSession(profile: ZenProfile, words: FolderWords): Promise<ZenRead> {
  const places = profile.files.includes('places.sqlite') ? await placesOf(profile) : null
  for (const file of profile.files.filter((one) => one.includes('session'))) {
    const session = await fileOf(profile, file)
      .then((said) => readZenSession(said, places))
      .catch(() => null)
    if (session) {
      const engine = profile.files.includes(SEARCH)
        ? mozillaEngine(await fileOf(profile, SEARCH).catch(() => null))
        : null
      return { sidebar: withBookmarks(session, places, words), engine }
    }
  }

  throw new Error('Zen’s tabs could not be read.')
}

async function fileOf(profile: ZenProfile, file: string): Promise<unknown> {
  const said = await invoke<string>('read_zen_file', { profile: profile.path, file })
  return JSON.parse(new TextDecoder().decode(unmozLz4(fromBase64(said)))) as unknown
}

async function placesOf(profile: ZenProfile): Promise<ZenPlaces | null> {
  try {
    const said = JSON.parse(
      await invoke<string>('read_zen_places', { profile: profile.path }),
    ) as Partial<ZenPlaces>
    return {
      spaces: Array.isArray(said.spaces) ? said.spaces : [],
      pins: Array.isArray(said.pins) ? said.pins : [],
      bookmarks: said.bookmarks ?? null,
      assigned: Array.isArray(said.assigned) ? said.assigned : [],
    }
  } catch {
    return null
  }
}
