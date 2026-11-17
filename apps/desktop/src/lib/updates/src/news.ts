import { fetchInTime, keep, storedText } from '../../platform/src/api'

const SEEN_KEY = 'orden:version-seen'

const RELEASE = /^\d+\.\d+\.\d+$/

const RELEASE_API = 'https://api.github.com/repos/lxorb/orden/releases/tags/v'

export interface News {
  version: string
  notes: string
}

async function notesOf(version: string): Promise<string> {
  const answer = await fetchInTime(`${RELEASE_API}${version}`, {
    headers: { accept: 'application/vnd.github+json' },
  })
  if (!answer.ok) return ''
  const { body } = (await answer.json()) as { body?: unknown }
  return typeof body === 'string' ? body.trim() : ''
}

export async function newsSince(now: string = __APP_VERSION__): Promise<News | null> {
  const seen = storedText(SEEN_KEY)
  if (seen === now) return null
  if (seen === null || !RELEASE.test(now)) {
    keep(SEEN_KEY, now)
    return null
  }

  const notes = await notesOf(now).catch(() => null)
  if (notes === null) return null
  keep(SEEN_KEY, now)
  return notes ? { version: now, notes } : null
}
