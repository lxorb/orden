import { readWebFile, rewriteShortcut, type Shortcut } from './shortcut'

export function settleShortcuts(
  path: string,
  ours: string,
  theirs: string,
  theirsNewer: boolean,
): string {
  if (ours === theirs) return ours

  const [newer, older] = theirsNewer ? [theirs, ours] : [ours, theirs]
  const fresh = readWebFile(path, newer)
  const stale = readWebFile(path, older)
  if (!fresh || !stale || /\.webloc$/i.test(path.trim())) return newer

  const chosen = fresh.chosen ?? stale.chosen
  const settled = rewriteShortcut(fresh, {
    title: fresh.title ?? stale.title ?? '',
    when: firstAdded(fresh, stale),
    home: fresh.home ?? fresh.url,
    icon: fresh.icon ?? stale.icon,
    own: fresh.own,
    chosen,
    chosenColour: fresh.chosen ? fresh.chosenColour : stale.chosenColour,
  })

  return sameShortcut(readWebFile(path, settled), fresh) ? newer : settled
}

export function sameWebNote(path: string, one: string, other: string): boolean {
  const a = readWebFile(path, one)
  const b = readWebFile(path, other)
  if (!a || !b) return one === other

  return (a.home ?? a.url) === (b.home ?? b.url)
}

function firstAdded(one: Shortcut, other: Shortcut): Date {
  const times = [one.added, other.added]
    .map((said) => (said ? new Date(said).getTime() : Number.NaN))
    .filter((time) => !Number.isNaN(time))

  return new Date(
    times.length ? times.reduce((low, one) => Math.min(low, one), Infinity) : Date.now(),
  )
}

function sameShortcut(one: Shortcut | null, other: Shortcut): boolean {
  return (
    one !== null &&
    one.url === other.url &&
    one.title === other.title &&
    one.added === other.added &&
    (one.home ?? null) === (other.home ?? null) &&
    one.icon === other.icon &&
    one.own === other.own &&
    one.chosen === other.chosen &&
    one.chosenColour === other.chosenColour
  )
}

export function sameSite(one: string | null | undefined, other: string | null | undefined) {
  const host = hostIn(one)
  return host !== null && host === hostIn(other)
}

function hostIn(address: string | null | undefined): string | null {
  if (!address) return null
  try {
    const url = new URL(address)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}
