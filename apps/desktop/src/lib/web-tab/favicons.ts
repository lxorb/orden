import { forget as unkeep, keep, keepJson } from '../stored'
import { drawable, favicons, keysOf, MARK, MARKS, type Seen } from './pages.svelte'

const MOST_PAGES = 500
const MOST_TEXT = 512 * 1024

const QUIET = 2000

let writing: ReturnType<typeof setTimeout> | undefined

function idOf(picture: string): string {
  let one = 0x811c9dc5
  let two = 0x01000193
  for (let at = 0; at < picture.length; at++) {
    const code = picture.charCodeAt(at)
    one = Math.imul(one ^ code, 2654435761)
    two = Math.imul(two ^ code, 1597334677)
  }
  return (one >>> 0).toString(36) + (two >>> 0).toString(36)
}

export function saw(url: string | null | undefined, picture: string) {
  const keys = keysOf(url)
  if (!keys || !drawable(picture)) return

  const id = idOf(picture)
  const index = favicons.index()
  const now = Date.now()
  const same = keys.every((key) => index.get(key)?.[0] === id)
  for (const key of keys) index.set(key, [id, now])
  if (same) return

  if (!favicons.sizes.has(id)) favicons.unwritten.set(id, picture)
  favicons.pictures.set(id, picture)
  within(index)
  favicons.changed++
  later()
}

export function forget(url: string | null | undefined) {
  const keys = keysOf(url)
  if (!keys) return

  const index = favicons.index()
  if (keys.map((key) => index.delete(key)).includes(true)) {
    favicons.changed++
    later()
  }
}

function within(index: Map<string, Seen>) {
  const holders: Record<string, number> = {}
  for (const [id] of index.values()) holders[id] = (holders[id] ?? 0) + 1

  const size = (id: string) =>
    favicons.sizes.get(id) ??
    favicons.unwritten.get(id)?.length ??
    favicons.pictures.get(id)?.length ??
    0
  let text = 0
  for (const id of Object.keys(holders)) text += size(id)
  if (index.size <= MOST_PAGES && text <= MOST_TEXT) return

  const oldest = [...index].sort(([, one], [, other]) => one[1] - other[1])
  for (const [key, [id]] of oldest) {
    if (index.size <= MOST_PAGES && text <= MOST_TEXT) return
    index.delete(key)
    const left = (holders[id] ?? 1) - 1
    holders[id] = left
    if (left === 0) text -= size(id)
  }
}

export function later() {
  writing ??= setTimeout(write, QUIET)
}

export function write() {
  clearTimeout(writing)
  writing = undefined
  const index = favicons.index()
  const { sizes, pictures, unwritten } = favicons

  const wanted = new Set([...index.values()].map(([id]) => id))
  const adding = [...unwritten].filter(([id]) => wanted.has(id))
  unwritten.clear()

  if (adding.length) {
    put(index, [...sizes, ...adding.map(([id, one]) => [id, one.length] as const)])
  }
  for (const [id, picture] of adding) {
    if (keep(MARK + id, picture)) sizes.set(id, picture.length)
  }
  for (const id of sizes.keys()) {
    if (wanted.has(id)) continue
    unkeep(MARK + id)
    sizes.delete(id)
  }
  for (const id of pictures.keys()) if (!wanted.has(id)) pictures.delete(id)

  put(index, sizes)
}

function put(index: Map<string, Seen>, sizes: Iterable<readonly [string, number]>) {
  keepJson(MARKS, { pages: Object.fromEntries(index), sizes: Object.fromEntries(sizes) })
}
