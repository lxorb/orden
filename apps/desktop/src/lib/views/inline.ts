import { heldEscapes, released } from '@orden/markdown/escapes'

export interface Piece {
  text: string
  strong?: boolean
  em?: boolean
  code?: boolean
  struck?: boolean
  link?: string
}

const FORMS: { pattern: RegExp; make: (found: RegExpExecArray) => Piece }[] = [
  { pattern: /`([^`]+)`/, make: (found) => ({ text: found[1] ?? '', code: true }) },
  {
    pattern: /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/,
    make: (found) => ({ text: found[2] ?? found[1] ?? '', link: found[1] ?? '' }),
  },
  {
    pattern: /\[([^\]]+)\]\(([^)\s]+)\)/,
    make: (found) => ({ text: found[1] ?? '', link: found[2] ?? '' }),
  },
  {
    pattern: /\*\*([^*]+)\*\*|__([^_]+)__/,
    make: (found) => ({ text: found[1] ?? found[2] ?? '', strong: true }),
  },
  { pattern: /~~([^~]+)~~/, make: (found) => ({ text: found[1] ?? '', struck: true }) },
  { pattern: /==([^=]+)==/, make: (found) => ({ text: found[1] ?? '' }) },
  {
    pattern: /(?<![\w*])\*([^*\s][^*]*)\*(?!\*)|(?<!\w)_([^_\s][^_]*)_(?!\w)/,
    make: (found) => ({ text: found[1] ?? found[2] ?? '', em: true }),
  },
]

export function pieces(words: string): Piece[] {
  return heldPieces(heldEscapes(words)).map((one) => {
    const text = released(one.text, one.code === true)
    return one.link === undefined ? { ...one, text } : { ...one, text, link: released(one.link) }
  })
}

function heldPieces(words: string): Piece[] {
  const out: Piece[] = []
  let rest = words
  while (rest) {
    let best: { at: number; length: number; piece: Piece } | null = null
    for (const form of FORMS) {
      const found = form.pattern.exec(rest)
      if (found && (best === null || found.index < best.at)) {
        best = { at: found.index, length: found[0].length, piece: form.make(found) }
      }
    }
    if (!best) {
      out.push({ text: rest })
      break
    }
    if (best.at > 0) out.push({ text: rest.slice(0, best.at) })
    out.push(best.piece)
    rest = rest.slice(best.at + best.length)
  }
  return out
}

export function plain(words: string): string {
  return pieces(words)
    .map((one) => one.text)
    .join('')
}
