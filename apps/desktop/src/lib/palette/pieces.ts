import { fuzzyPlaces } from './match'
import { LONGEST } from './rank'

export interface Piece {
  text: string
  hit: boolean
}

export function pieces(name: string, term: string): Piece[] {
  const hits = new Set<number>()
  for (const word of term.slice(0, LONGEST).split(/\s+/).filter(Boolean)) {
    const at = fuzzyPlaces(word, name)
    if (!at) return [{ text: name, hit: false }]
    for (const one of at) hits.add(one)
  }

  const out: Piece[] = []
  for (let index = 0; index < name.length; index++) {
    const hit = hits.has(index)
    const last = out.at(-1)
    if (last?.hit === hit) last.text += name.charAt(index)
    else out.push({ text: name.charAt(index), hit })
  }

  return out
}
