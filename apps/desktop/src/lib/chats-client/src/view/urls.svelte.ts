import { SvelteMap } from 'svelte/reactivity'
import type { Chats } from '../shapes'
import { store } from './source.svelte'

const FIRST_WAIT = 2_000
const LONGEST_WAIT = 5 * 60_000

interface Miss {
  tries: number
  timer: ReturnType<typeof setTimeout> | null
}

const known = new SvelteMap<string, string>()
const freed = new SvelteMap<string, number>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- what was asked; nothing draws from it
const asked = new Set<string>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- asks still out; nothing draws from it
const out = new Set<string>()
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the misses; nothing draws from it
const missed = new Map<string, Miss>()

let session: { store: Chats; me: string | null; epoch: number; n: number } = {
  store: store(),
  me: null,
  epoch: 0,
  n: 0,
}
let listening = false

export function fileUrl(chat: string, hash: string): string | null {
  const current = store()
  const { me, fileEpoch } = current
  if (current !== session.store || me !== session.me || fileEpoch !== session.epoch) {
    begin(current)
  }
  const key = `${session.n}/${chat}/${hash}`
  freed.get(key)
  if (!asked.has(key)) {
    asked.add(key)
    ask(chat, hash, key)
  }
  return known.get(key) ?? null
}

function begin(current: Chats): void {
  session = { store: current, me: current.me, epoch: current.fileEpoch, n: session.n + 1 }
  asked.clear()
  out.clear()
  for (const { timer } of missed.values()) if (timer) clearTimeout(timer)
  missed.clear()
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
  queueMicrotask(() => {
    if (session === asking && !freed.has(key)) freed.set(key, 0)
  })
  void store()
    .fileUrl(chat, hash)
    .then(answered, () => answered(null))
}

function miss(key: string): void {
  const was = missed.get(key)
  if (was?.timer) clearTimeout(was.timer)
  const tries = (was?.tries ?? 0) + 1
  const wait = Math.min(FIRST_WAIT * 2 ** (tries - 1), LONGEST_WAIT) * (0.75 + Math.random() / 2)
  missed.set(key, { tries, timer: setTimeout(() => free(key), wait) })
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('online', again)
  }
}

function free(key: string): void {
  const was = missed.get(key)
  if (was) was.timer = null
  asked.delete(key)
  freed.set(key, (freed.get(key) ?? 0) + 1)
}

function again(): void {
  for (const [key, was] of missed) {
    if (out.has(key) || !asked.has(key)) continue
    if (was.timer) clearTimeout(was.timer)
    was.tries = 0
    free(key)
  }
}
