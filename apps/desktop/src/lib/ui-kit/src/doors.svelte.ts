import { door } from '@orden/markdown/door'

export function held<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  return door(() => load().then((one) => one.default))
}
const never = new Promise<never>(() => undefined)
export interface Latched<T> {
  ask: () => Promise<T>
  readonly asked: Promise<T> | null
}
export function latched<T>(load: () => Promise<{ default: T }>): Latched<T> {
  const fetch = held(load)
  let asking: Promise<T> | null = null
  let answer: Promise<T> = never
  let asked = $state<Promise<T> | null>(null)
  return {
    ask: () => {
      const fetching = fetch()
      if (fetching === asking) return answer
      asking = fetching
      answer = fetching.catch(() => never)
      asked = answer
      fetching.catch(() => {
        if (asking !== fetching) return
        asking = null
        asked = null
      })
      return answer
    },
    get asked() {
      return asked
    },
  }
}
interface Readied<T> {
  ask: () => Promise<T | null>
  readonly one: T | null
}
export function readied<T>(load: () => Promise<{ default: T }>): Readied<T> {
  const fetch = held(load)
  let one = $state.raw<T | null>(null)
  return {
    ask: () =>
      fetch().then(
        (got) => (one = got),
        () => one,
      ),
    get one() {
      return one
    },
  }
}
