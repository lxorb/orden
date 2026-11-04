/** The pictures the overview keeps of windows that are not on screen (issue #331): what
 *  one is, how one is drawn again safely, which to let go when there are too many, and
 *  the store they are kept in.
 *
 *  Emil, 2026-11-04: every window that was ever open keeps a picture of itself - every
 *  kind of note, terminals and web pages too - so a window whose tab is not loaded right
 *  now still shows what it showed. Kept on this device, within a size, and gone with its
 *  tab.
 *
 *  A picture of a pane is its markup as it was drawn (mirror.ts `snapshotOf`), which the
 *  app's own stylesheets draw again exactly, at any size, for a fraction of the bytes of
 *  pixels; a web page is the engine's photograph of it. IndexedDB rather than local
 *  storage, which a launch reads whole before its first answer: one database of its own,
 *  as the wallpaper has (wallpaper/kept.ts), and every failure is nothing kept. */

/** One window's picture. */
export interface Face {
  /** The pane as it was drawn, for every kind but a web page. */
  html: string | null
  /** A web page's photograph, as a data address. */
  shot: string | null
  /** The size it was drawn at. */
  w: number
  h: number
  /** When it was taken, which the oldest are let go by. */
  at: number
}

/** All of them together no larger than this many characters, about forty megabytes as
 *  the store holds them, and none larger than a fiftieth of it. */
const BUDGET = 20_000_000
export const LARGEST = BUDGET / 50

export function sizeOf(face: Face): number {
  return (face.html?.length ?? 0) + (face.shot?.length ?? 0)
}

/** Whether something read back from the store is a picture. */
export function isFace(value: unknown): value is Face {
  if (typeof value !== 'object' || value === null) return false
  const { html, shot, w, h, at } = value as Record<string, unknown>
  const text = (one: unknown) => one === null || typeof one === 'string'
  const number = (one: unknown) => typeof one === 'number' && Number.isFinite(one)
  return text(html) && text(shot) && number(w) && number(h) && number(at)
}

/** Which pictures go so the rest fit in `budget`: the oldest first. */
export function evicted(faces: readonly [string, Face][], budget = BUDGET): string[] {
  let total = faces.reduce((sum, [, face]) => sum + sizeOf(face), 0)
  const out: string[] = []
  for (const [key, face] of [...faces].sort((a, b) => a[1].at - b[1].at)) {
    if (total <= budget) break
    out.push(key)
    total -= sizeOf(face)
  }
  return out
}

/** Elements a picture never brings back: nothing that runs, loads or styles the app. */
const UNSAFE = 'script, style, link, meta, iframe, frame, object, embed, base, form'

/** A picture's markup, drawn into `into`: parsed inert, and stripped of anything that
 *  could run, load something or restyle the app around it. What a pane drew was the
 *  app's own, but what is read back from the store is only what the store says. */
export function drawInto(into: Element, html: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  for (const one of root.querySelectorAll(UNSAFE)) one.remove()
  for (const one of root.querySelectorAll('*')) {
    for (const { name, value } of [...one.attributes]) {
      const lower = name.toLowerCase()
      const link = /^(?:href|src|xlink:href|action|formaction|srcset)$/.test(lower)
      if (
        lower.startsWith('on') ||
        (link && !/^(?:data:image\/|blob:|https?:|asset:|\/)/i.test(value.trim()))
      )
        one.removeAttribute(name)
    }
  }
  into.replaceChildren(root)
}

const NAME = 'nib-overview-faces'
const STORE = 'face'

let open: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  open ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 2)
    request.onupgradeneeded = ({ oldVersion }) => {
      if (oldVersion < 1) request.result.createObjectStore(STORE)
      // Version 1 kept private tabs' pictures too, under the name any web page has, so no
      // web page's stays; each is taken again the next time it is covered.
      else request.transaction?.objectStore(STORE).delete(IDBKeyRange.bound('web:', 'web:\uffff'))
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the faces store did not open'))
  })
  // A refusal is not kept: a private window that refused once may be asked again.
  open.catch(() => (open = null))
  return open
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the faces store refused'))
  })
}

async function asked<T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database()
  return settled(ask(db.transaction(STORE, mode).objectStore(STORE)))
}

/** The store brought up to this version, which is what wipes what an earlier one should
 *  not have kept: at launch, not the first time the overview asks. */
export async function upgradeFaces(): Promise<void> {
  await database().catch(() => undefined)
}

/** Every picture kept, by the lasting name of its tab; none where the store will not
 *  answer. */
export async function readFaces(): Promise<[string, Face][]> {
  try {
    const keys = await asked('readonly', (store) => store.getAllKeys())
    const values = await asked('readonly', (store) => store.getAll())
    const out: [string, Face][] = []
    keys.forEach((key, index) => {
      const value: unknown = values[index]
      if (typeof key === 'string' && isFace(value)) out.push([key, value])
    })
    return out
  } catch {
    return []
  }
}

export async function writeFace(key: string, face: Face): Promise<void> {
  try {
    await asked('readwrite', (store) => store.put(face, key))
  } catch {
    // Not kept: the window shows what it would have without it.
  }
}

export async function forgetFaces(keys: readonly string[]): Promise<void> {
  if (!keys.length) return
  try {
    const db = await database()
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
    await Promise.all(keys.map((key) => settled(store.delete(key))))
  } catch {
    // Nothing kept is what was asked for.
  }
}
