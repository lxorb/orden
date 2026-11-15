import { findLinks, shownText } from '@orden/markdown/links'

interface LinePiece {
  text: string
  link: boolean
}

const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\([^)\n]*\)/g

export function linkPieces(line: string): LinePiece[] {
  const pieces: LinePiece[] = []
  let at = 0

  const words = (to: number) => {
    if (to > at) plain(line.slice(at, to), pieces)
  }

  for (const link of findLinks(line)) {
    words(link.from)
    pieces.push({ text: shownText(link), link: true })
    at = link.to
  }
  words(line.length)

  return pieces
}

export function shownLine(line: string): string {
  return linkPieces(line)
    .map((one) => one.text)
    .join('')
}

function plain(text: string, into: LinePiece[]) {
  let at = 0

  for (const match of text.matchAll(MARKDOWN_LINK)) {
    if (match.index > at) into.push({ text: text.slice(at, match.index), link: false })
    into.push({ text: match[1] ?? '', link: true })
    at = match.index + match[0].length
  }

  if (at < text.length) into.push({ text: text.slice(at), link: false })
}
