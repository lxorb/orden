import { workspace } from '../../workspace.svelte'
import { plainOrigin } from '@orden/scan/web-address'
import { clipNote, clipSource } from './note'
import { pages } from './pages.svelte'

export async function clipPage(
  tabId: string,
  space: string | null,
  fallback: { url: string | null; title: string },
): Promise<string | null> {
  const read = await pages.read(tabId, true)

  const url = clipSource(read?.url, fallback.url)
  if (url === null) return null

  const named = (read?.title ?? fallback.title).trim()
  const page = { url, title: named.length ? named : plainOrigin(url), html: read?.html ?? '' }

  const root = workspace.spaces.find((one) => one.id === space)?.root
  const path = root ? await workspace.noteFrom(await clipNote(page, new Date()), root) : null
  if (path === null) {
    const why = root ? 'you can only read this space' : 'no such space'
    pages.of(tabId).notice = `Save as a note: ${why}`
  }
  return path
}
