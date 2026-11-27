import { mimeOfPath, normalise, sha256, showAssetsFrom, UNKNOWN_TYPE } from '../../../platform/src/api'

const PLACE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=#'
const TAGS = ['img', 'audio', 'video', 'source']
const SHOWN = TAGS.join(',')
const NAMED = TAGS.flatMap((tag) => [`${tag}[src^="${PLACE}"]`, `${tag}[src^="blob:"]`]).join(',')
type Shown = HTMLImageElement | HTMLMediaElement | HTMLSourceElement
type Bytes = Uint8Array | null
interface Held {
  url: string
  sum: string
}
const held = new Map<string, Held>()
const named = new Map<string, string>()
const reading = new Map<string, Promise<Held | null>>()
const turns = new Map<string, Promise<unknown>>()
const missed = new WeakSet<Element>()
let read: (path: string) => Promise<Bytes> = () => Promise.resolve(null)
const place = (path: string): string => PLACE + path.split('/').map(encodeURIComponent).join('/')
function pathOf(url: string): string | null {
  if (!url.startsWith(PLACE)) return named.get(url.split('#')[0] ?? url) ?? null
  try {
    return normalise(decodeURIComponent(url.slice(PLACE.length)))
  } catch {
    return null
  }
}
async function hold(path: string, bytes: Uint8Array, sum?: string): Promise<Held> {
  const one = {
    url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeOfPath(path) ?? UNKNOWN_TYPE })),
    sum: sum ?? (await sha256(bytes)),
  }
  named.set(one.url, path)
  held.set(path, one)
  return one
}
function loaded(path: string): Promise<Held | null> {
  const one = held.get(path)
  if (one) return Promise.resolve(one)
  const before = reading.get(path)
  if (before) return before
  const asked = read(path)
    .then(
      (bytes) => (bytes ? (held.get(path) ?? hold(path, bytes)) : null),
      () => null,
    )
    .finally(() => reading.delete(path))
  reading.set(path, asked)
  return asked
}
function point(el: Shown, src: string): void {
  el.setAttribute('src', src)
  if (el instanceof HTMLSourceElement && el.parentElement instanceof HTMLMediaElement) el.parentElement.load()
}
const showing = (src: string): Shown[] => [
  ...document.querySelectorAll<Shown>(TAGS.map((tag) => `${tag}[src="${src}"]`).join(',')),
]
function fill(el: Shown): void {
  const src = el.getAttribute('src') ?? ''
  const path = pathOf(src)
  if (path === null) return
  const one = held.get(path)
  if (one) {
    if (!src.startsWith(one.url)) point(el, one.url)
    return
  }
  missed.delete(el)
  void loaded(path).then((got) => {
    if (el.getAttribute('src') !== src) return
    if (got) point(el, got.url)
    else if (!src.startsWith(PLACE)) point(el, place(path))
    else {
      missed.add(el)
      el.dispatchEvent(new Event('error'))
    }
  })
}
function turn(path: string, run: () => Promise<void>): Promise<void> {
  const mine = (turns.get(path) ?? Promise.resolve()).then(run, run)
  const settled = mine.catch(() => undefined)
  turns.set(path, settled)
  void settled.then(() => {
    if (turns.get(path) === settled) turns.delete(path)
  })
  return mine
}
async function gone(path: string): Promise<void> {
  await reading.get(path)
  const before = held.get(path)
  if (!before) return
  held.delete(path)
  for (const el of showing(before.url)) point(el, place(path))
  URL.revokeObjectURL(before.url)
}
export function assetWritten(path: string, bytes: () => Bytes | Promise<Bytes>): Promise<void> {
  const at = normalise(path)
  return turn(at, async () => {
    await reading.get(at)
    const before = held.get(at)
    if (!before) {
      for (const el of showing(place(at))) fill(el)
      return
    }
    const now = await bytes()
    if (!now) return gone(at)
    const sum = await sha256(now)
    if (sum === before.sum) return
    const after = await hold(at, now, sum)
    for (const el of showing(before.url)) point(el, after.url)
    URL.revokeObjectURL(before.url)
  })
}
export function assetGone(path: string): Promise<void> {
  const at = normalise(path)
  return turn(at, () => gone(at))
}
function guard(event: Event): void {
  const el = event.target
  if (!(el instanceof Element) || !el.matches(SHOWN)) return
  if (!(el.getAttribute('src') ?? '').startsWith(PLACE)) return
  if (event.type === 'error' && missed.has(el)) return
  event.stopImmediatePropagation()
}
function seen(records: MutationRecord[]): void {
  for (const record of records) {
    if (record.type === 'attributes') {
      if (record.target instanceof Element && record.target.matches(NAMED)) fill(record.target as Shown)
      continue
    }
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue
      if (node.matches(NAMED)) fill(node as Shown)
      if (node.firstElementChild) for (const el of node.querySelectorAll<Shown>(NAMED)) fill(el)
    }
  }
}
export function showAssets(reader: (path: string) => Promise<Bytes>): void {
  read = reader
  showAssetsFrom({ url: (path) => place(normalise(path)), path: pathOf })
  document.addEventListener('load', guard, true)
  document.addEventListener('error', guard, true)
  new MutationObserver(seen).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  })
  for (const el of document.querySelectorAll<Shown>(NAMED)) fill(el)
}
