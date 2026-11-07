import { heldDatabase } from '../held-database'

export interface Face {
  html: string | null
  shot: string | null
  w: number
  h: number
  at: number
}

const BUDGET = 20_000_000
export const LARGEST = BUDGET / 50

export function sizeOf(face: Face): number {
  return (face.html?.length ?? 0) + (face.shot?.length ?? 0)
}

export function isFace(value: unknown): value is Face {
  if (typeof value !== 'object' || value === null) return false
  const { html, shot, w, h, at } = value as Record<string, unknown>
  const text = (one: unknown) => one === null || typeof one === 'string'
  const number = (one: unknown) => typeof one === 'number' && Number.isFinite(one)
  return text(html) && text(shot) && number(w) && number(h) && number(at)
}

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

const UNSAFE = 'script, style, link, meta, iframe, frame, object, embed, base, form'

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

const held = heldDatabase(NAME, 2, (request, oldVersion) => {
  if (oldVersion < 1) request.result.createObjectStore(STORE)
  else request.transaction?.objectStore(STORE).delete(IDBKeyRange.bound('web:', 'web:\uffff'))
})

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('the faces store refused'))
  })
}

async function asked<T>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<T>) {
  return settled(ask((await held.transaction(STORE, mode)).objectStore(STORE)))
}

export async function upgradeFaces(): Promise<void> {
  await held.transaction(STORE).catch(() => undefined)
}

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
    const store = (await held.transaction(STORE, 'readwrite')).objectStore(STORE)
    await Promise.all(keys.map((key) => settled(store.delete(key))))
  } catch {
    // Nothing kept is what was asked for.
  }
}
