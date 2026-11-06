import type { InternalBytes, InternalWorld } from './folder'

export class MemoryBytes implements InternalBytes {
  readonly texts = new Map<string, string>()
  readonly blobs = new Map<string, Uint8Array>()
  readonly slots: (string | null)[] = [null, null]
  writes = 0
  failSlots = false

  readText(key: string) {
    return Promise.resolve(this.texts.get(key) ?? null)
  }

  writeText(key: string, text: string) {
    this.writes += 1
    this.texts.set(key, text)
    return Promise.resolve()
  }

  read(key: string) {
    return Promise.resolve(this.blobs.get(key) ?? null)
  }

  write(key: string, bytes: Uint8Array) {
    this.writes += 1
    this.blobs.set(key, bytes)
    return Promise.resolve()
  }

  remove(key: string) {
    this.texts.delete(key)
    this.blobs.delete(key)
    return Promise.resolve()
  }

  slot(at: 0 | 1) {
    return Promise.resolve(this.slots[at] ?? null)
  }

  writeSlot(at: 0 | 1, text: string) {
    this.slots[at] = null
    if (this.failSlots) return Promise.reject(new Error('the disk is full'))
    this.slots[at] = text
    return Promise.resolve()
  }

  where(key: string) {
    return `/spaces/.orden/one/entries/${key}`
  }
}

export function sharedWindows() {
  let lock: Promise<unknown> = Promise.resolve()
  const listeners = new Set<(message: unknown) => void>()
  const flying = new Set<Promise<void>>()
  let keys = 0
  let clock = 1000
  return {
    world(): Partial<InternalWorld> {
      return {
        now: () => (clock += 1),
        key: () => `k${String((keys += 1))}`,
        exclusive<T>(_name: string, then: () => Promise<T>): Promise<T> {
          const turn = lock.then(then, then)
          lock = turn.catch(() => undefined)
          return turn
        },
        channel(_name, heard) {
          const own = (message: unknown) => {
            heard(message)
          }
          listeners.add(own)
          return {
            post(message) {
              for (const one of listeners) {
                if (one === own) continue
                const delivery = Promise.resolve().then(() => {
                  one(message)
                })
                flying.add(delivery)
                void delivery.finally(() => flying.delete(delivery))
              }
            },
            close() {
              listeners.delete(own)
            },
          }
        },
      }
    },
    async settled() {
      while (flying.size) await Promise.all([...flying])
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
  }
}
