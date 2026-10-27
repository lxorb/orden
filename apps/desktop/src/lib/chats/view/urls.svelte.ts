/** Where a chat's files are drawn from (docs/chats.md 4.8). The store answers a file's
 *  address when asked (`Chats.fileUrl`), which may be a round trip; a row draws at once,
 *  so the address is asked once per file, kept, and the row draws again when it lands.
 *  Until then a picture is its stated size in the surface's ground, never a jump.
 *
 *  Only an address is kept. A fetch that failed (offline, a 5xx) is let go after a wait
 *  that doubles, give or take a quarter, and at once when the device is back online; the
 *  rows that still draw the file then ask again, and a file no row draws is not asked at
 *  all. After `MOST_TRIES` asks only coming back online lets a file go again. Everything
 *  here belongs to one session: another store or another reader starts from nothing. */

import { SvelteMap } from 'svelte/reactivity'
import type { Chats } from '../api'
import { store } from './source.svelte'

/** How many times a file is asked before only `online` lets it go again. */
export const MOST_TRIES = 8
const FIRST_WAIT = 2_000
const LONGEST_WAIT = 5 * 60_000

interface Miss {
  tries: number
  timer: ReturnType<typeof setTimeout> | null
}

const known = new SvelteMap<string, string>()
/** Bumped when a miss is let go, so the rows that draw the file read it again. */
const freed = new SvelteMap<string, number>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- what was asked; nothing draws from it
const asked = new Set<string>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- asks still out; nothing draws from it
const out = new Set<string>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the misses; nothing draws from it
const missed = new Map<string, Miss>()

let session: { store: Chats; me: string | null; n: number } = { store: store(), me: null, n: 0 }
let listening = false

/** A file's address, or null while it is on its way or where there is none. */
export function fileUrl(chat: string, hash: string): string | null {
  const current = store()
  if (current !== session.store || current.me !== session.me) begin(current)
  const key = `${session.n}/${chat}/${hash}`
  freed.get(key)
  if (!asked.has(key)) {
    asked.add(key)
    ask(chat, hash, key)
  }
  return known.get(key) ?? null
}

/** Another store or reader: what the last one asked, kept and waits on goes. Its keys
 *  are another session's from here on, so nothing of it is drawn. */
function begin(current: Chats): void {
  session = { store: current, me: current.me, n: session.n + 1 }
  asked.clear()
  out.clear()
  for (const { timer } of missed.values()) if (timer) clearTimeout(timer)
  missed.clear()
  // Not from inside the read that noticed: a row's template may not write what it reads.
  const stale = `${session.n - 1}/`
  queueMicrotask(() => {
    for (const map of [known, freed]) {
      for (const key of [...map.keys()]) if (key.startsWith(stale)) map.delete(key)
    }
  })
}

function ask(chat: string, hash: string, key: string): void {
  const asking = session
  const answered = (url: string | null) => {
    if (session !== asking) return
    out.delete(key)
    if (url) {
      missed.delete(key)
      known.set(key, url)
    } else miss(key)
  }
  out.add(key)
  void store()
    .fileUrl(chat, hash)
    .then(answered, () => answered(null))
}

function miss(key: string): void {
  const was = missed.get(key)
  if (was?.timer) clearTimeout(was.timer)
  const tries = (was?.tries ?? 0) + 1
  const wait = Math.min(FIRST_WAIT * 2 ** (tries - 1), LONGEST_WAIT) * (0.75 + Math.random() / 2)
  const timer = tries < MOST_TRIES ? setTimeout(() => free(key), wait) : null
  missed.set(key, { tries, timer })
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('online', again)
  }
}

/** Lets a miss be asked again by the next row that draws it. */
function free(key: string): void {
  const was = missed.get(key)
  if (was) was.timer = null
  asked.delete(key)
  freed.set(key, (freed.get(key) ?? 0) + 1)
}

/** Back online: every miss that waits, or has run out of tries, is let go now, with one
 *  more try. A file whose ask is still out, or that no row has asked again, is left. */
function again(): void {
  for (const [key, was] of missed) {
    if (out.has(key) || !asked.has(key)) continue
    if (was.timer) clearTimeout(was.timer)
    was.tries = Math.min(was.tries, MOST_TRIES - 1)
    free(key)
  }
}
