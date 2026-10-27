/** Where a chat's files are drawn from (docs/chats.md 4.8). The store answers a file's
 *  address when asked (`Chats.fileUrl`), which may be a round trip; a row draws at once,
 *  so the address is asked once per file, kept, and the row draws again when it lands.
 *  A fetch that failed is asked again (`miss`), never kept as none.
 *  Until then a picture is its stated size in the surface's ground, never a jump. */

import { SvelteMap } from 'svelte/reactivity'
import { store } from './source.svelte'

const known = new SvelteMap<string, string | null>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- what was asked; nothing draws from it
const asked = new Set<string>()
/** A file whose fetch failed (offline, a 5xx) and the wait before it is asked again. Only an
 *  address is kept; a miss is asked again after a wait that doubles, and at once when the
 *  device is back online. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the misses; nothing draws from it
const missed = new Map<
  string,
  { chat: string; hash: string; wait: number; timer: ReturnType<typeof setTimeout> }
>()
const FIRST_WAIT = 2_000
const LONGEST_WAIT = 5 * 60_000
let listening = false

/** A file's address, or null while it is on its way or where there is none. */
export function fileUrl(chat: string, hash: string): string | null {
  const key = `${chat}/${hash}`
  if (!asked.has(key)) {
    asked.add(key)
    ask(chat, hash, key)
  }
  return known.get(key) ?? null
}

function ask(chat: string, hash: string, key: string): void {
  void store()
    .fileUrl(chat, hash)
    .then(
      (url) => (url ? landed(key, url) : miss(chat, hash, key)),
      () => miss(chat, hash, key),
    )
}

function landed(key: string, url: string): void {
  missed.delete(key)
  known.set(key, url)
}

function miss(chat: string, hash: string, key: string): void {
  const wait = Math.min((missed.get(key)?.wait ?? FIRST_WAIT / 2) * 2, LONGEST_WAIT)
  const timer = setTimeout(() => ask(chat, hash, key), wait)
  missed.set(key, { chat, hash, wait, timer })
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('online', again)
  }
}

/** Back online: every miss is asked now, its wait starting over. */
function again(): void {
  for (const [key, { chat, hash, timer }] of missed) {
    clearTimeout(timer)
    missed.delete(key)
    ask(chat, hash, key)
  }
}
