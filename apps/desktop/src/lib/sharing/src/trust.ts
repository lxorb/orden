export type Origin = 'guest' | 'paste' | 'room' | 'space' | 'own'

export interface Provenance {
  guest: boolean
  pasted: boolean
  shared: boolean
  peers: boolean
}

export function originOf(who: Provenance): Origin {
  if (who.guest) return 'guest'
  if (who.pasted) return 'paste'
  if (who.shared) return who.peers ? 'room' : 'space'
  return 'own'
}

export function trustsHtml(origin: Origin): boolean {
  return origin === 'own'
}

export function pastesMarkup(types: readonly string[], text: string): boolean {
  if (types.includes('text/html')) return true
  return /<[a-z][\w:-]*(?:[\s/>]|$)/i.test(text)
}
