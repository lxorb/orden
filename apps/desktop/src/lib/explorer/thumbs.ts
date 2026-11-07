import { SvelteMap } from 'svelte/reactivity'
import { type Peek, peekAt } from './commands'
import { pictureBlob } from './preview'

export const THUMB_MOST = 8 * 1024 * 1024

const AT_ONCE = 4
const SIDE = 224
const KEPT = 400
const WHOLE_MOST = 256 * 1024

export interface Wanted {
  path: string
  name: string
  stamp?: string
}

type Read = (path: string, most: number) => Promise<Peek>
type Shrink = (name: string, read: Peek) => Promise<string | null>

async function shrunk(name: string, read: Peek): Promise<string | null> {
  const blob = pictureBlob(name, read)
  if (!blob) return null
  const whole = () => (blob.size <= WHOLE_MOST ? URL.createObjectURL(blob) : null)
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return whole()
  }
  try {
    const picture = await createImageBitmap(blob)
    const by = Math.min(1, SIDE / Math.max(picture.width, picture.height, 1))
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(picture.width * by)),
      Math.max(1, Math.round(picture.height * by)),
    )
    canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height)
    picture.close()
    return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }))
  } catch {
    return whole()
  }
}

export class Thumbs {
  readonly shown = new SvelteMap<string, string>()
  #folder: string | null = null
  #asked = new Map<string, string>()
  #wanted = new Set<string>()
  #waiting: Wanted[] = []
  #running = 0
  readonly #read: Read
  readonly #shrink: Shrink

  constructor(read: Read = peekAt, shrink: Shrink = shrunk) {
    this.#read = read
    this.#shrink = shrink
  }

  want(folder: string | null, wanted: Wanted[]): void {
    if (folder !== this.#folder) {
      this.clear()
      this.#folder = folder
    }
    this.#wanted = new Set(wanted.map((one) => one.path))
    this.#waiting = this.#waiting.filter((one) => {
      const kept = this.#wanted.has(one.path)
      if (!kept) this.#asked.delete(one.path)
      return kept
    })
    for (const one of wanted) {
      const stamp = one.stamp ?? ''
      if (this.#asked.get(one.path) === stamp) continue
      this.#asked.set(one.path, stamp)
      this.#waiting.push(one)
    }
    this.#next()
  }

  clear(): void {
    for (const url of this.shown.values()) URL.revokeObjectURL(url)
    this.shown.clear()
    this.#asked.clear()
    this.#waiting = []
    this.#folder = null
  }

  #next(): void {
    while (this.#running < AT_ONCE) {
      const one = this.#waiting.shift()
      if (!one) return
      const stamp = one.stamp ?? ''
      if (this.#asked.get(one.path) !== stamp) continue
      this.#running++
      const folder = this.#folder
      void this.#read(one.path, THUMB_MOST)
        .then((read) => this.#shrink(one.name, read))
        .catch(() => null)
        .then((url) => {
          if (!url) return
          if (folder !== this.#folder || this.#asked.get(one.path) !== stamp) {
            URL.revokeObjectURL(url)
            return
          }
          const before = this.shown.get(one.path)
          this.shown.set(one.path, url)
          if (before) URL.revokeObjectURL(before)
          this.#trim()
        })
        .finally(() => {
          this.#running--
          this.#next()
        })
    }
  }

  #trim(): void {
    for (const [path, url] of this.shown) {
      if (this.shown.size <= KEPT) return
      if (this.#wanted.has(path)) continue
      URL.revokeObjectURL(url)
      this.shown.delete(path)
      this.#asked.delete(path)
    }
  }
}
