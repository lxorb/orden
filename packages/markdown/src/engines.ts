import { door } from './door'

type Maths = (typeof import('./maths'))['default']

type Emoji = typeof import('node-emoji')

let maths: Maths | null = null
let emoji: Emoji | null = null

const fetchMaths = door(async () => {
  useMaths((await import('./maths')).default)
})
const fetchEmoji = door(async () => {
  useEmoji(await import('node-emoji'))
})

export const MOST_EMS = 100

const listeners = new Set<() => void>()

function landed() {
  for (const listen of [...listeners]) listen()
}

export function mathsEngine(): Maths | null {
  return maths
}

export function emojiTable(): Emoji | null {
  return emoji
}

export function useMaths(engine: Maths) {
  maths = engine
  landed()
}

export function useEmoji(table: Emoji) {
  emoji = table
  landed()
}

export function loadMaths(): Promise<void> {
  return maths ? Promise.resolve() : fetchMaths()
}

export function loadEmoji(): Promise<void> {
  return emoji ? Promise.resolve() : fetchEmoji()
}

function hasMaths(source: string): boolean {
  return source.includes('$')
}

const SHORTCODE = /:[a-z0-9_+-]+:/i

function hasEmoji(source: string): boolean {
  return source.includes(':') && SHORTCODE.test(source)
}

export function loadFor(source: string): Promise<void> {
  const wanted: Promise<void>[] = []
  if (!maths && hasMaths(source)) wanted.push(loadMaths())
  if (!emoji && hasEmoji(source)) wanted.push(loadEmoji())

  return wanted.length === 0 ? Promise.resolve() : Promise.all(wanted).then(() => undefined)
}

export function onEngines(listen: () => void): () => void {
  listeners.add(listen)
  return () => listeners.delete(listen)
}
