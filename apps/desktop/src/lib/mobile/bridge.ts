export interface NibSystem {
  insets(): string
  askForTheFrame(): void
  bars(dark: boolean): void
  handed(said: string): string
  shared(said: string): string
  sharedBytes(said: string, at: number, offset: number, length: number): string
  sharedDone(said: string): void
  widgets(said: string, json: string): void
  dictates(): boolean
  listen(said: string, on: boolean): boolean
  secretRead(said: string, name: string): string | null
  secretWrite(said: string, name: string, secret: string): void
  secretForget(said: string, name: string): void
  reminders(said: string, json: string): void
  remindersTaken(said: string): string
  ownerCan(said: string): boolean
  ownerCheck(said: string, reason: string): void
  exactAlarms(): boolean
  askExactAlarms(): void
}

export function method<K extends keyof NibSystem>(name: K): NibSystem[K] | undefined {
  const found: unknown = (globalThis as { __ORDEN_SYSTEM__?: unknown }).__ORDEN_SYSTEM__
  if (typeof found !== 'object' || found === null) return undefined

  const held = (found as Partial<NibSystem>)[name]
  return typeof held === 'function' ? (held.bind(found) as NibSystem[K]) : undefined
}

export function onTheActivity(): boolean {
  return !!method('insets')
}

let word: Promise<string> | undefined

let known: string | undefined
let heard: (word: string) => void = () => undefined
const spoken = new Promise<string>((said) => (heard = said))

const PATIENCE = 2000

export function frameWord(): Promise<string> {
  if (known) return Promise.resolve(known)
  if (word) return word

  const ask = method('askForTheFrame')
  if (!ask) return Promise.resolve('')

  const asking = new Promise<string>((said) => {
    const timer = setTimeout(() => said(''), PATIENCE)
    answer('__nibFrame', (text: string) => {
      if (!text) return
      known = text
      heard(text)
      clearTimeout(timer)
      said(text)
    })
    try {
      ask()
    } catch {
      clearTimeout(timer)
      said('')
    }
  })
  word = asking
  void asking.then(() => {
    if (word === asking) word = undefined
  })
  return asking
}

export function wordSaid(): Promise<string> {
  return spoken
}

export class NoWord extends Error {
  override readonly name = 'NoWord'
  override readonly message = 'the phone app is still starting; try again in a moment'
}

export function answer(
  name: string,
  fn: ((text: string) => void) | (() => void) | undefined,
): void {
  if (typeof window === 'undefined') return
  Object.assign(window, { [name]: fn })
}
