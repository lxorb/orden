import { answer, frameWord, method } from '../../platform/src/api'
import type { Screen } from './nav.svelte'

const SCREENS: readonly Screen[] = ['now', 'day', 'stats']
export function screenOf(link: string): Screen | null {
  const found = /^orden-track:\/\/([a-z]+)\/?$/.exec(link.trim())
  return SCREENS.find((one) => one === found?.[1]) ?? null
}
export function linkIn(json: string): string {
  try {
    const held: unknown = JSON.parse(json)
    const link = typeof held === 'object' && held !== null ? (held as { link?: unknown }).link : ''
    return typeof link === 'string' ? link : ''
  } catch {
    return ''
  }
}
export function followLinks(show: (screen: Screen) => void): () => void {
  const handed = method('handed')
  if (!handed) return () => undefined
  let gone = false
  const take = () =>
    void frameWord().then((word) => {
      const screen = word && !gone ? screenOf(linkIn(handed(word))) : null
      if (screen) show(screen)
    })
  answer('__ordenHanded', take)
  take()
  return () => {
    gone = true
    answer('__ordenHanded', undefined)
  }
}
