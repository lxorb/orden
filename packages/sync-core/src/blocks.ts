import { closesFence, fenceMark } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'

type BlockKind = 'front-matter' | 'heading' | 'paragraph' | 'item' | 'fence' | 'row' | 'quote'

export interface Block {
  from: number
  to: number
  kind: BlockKind
}

interface Line {
  from: number
  to: number
  text: string
}

function linesOf(text: string, from: number): Line[] {
  const out: Line[] = []
  let at = from
  while (at < text.length) {
    const end = text.indexOf('\n', at)
    const stop = end === -1 ? text.length : end
    out.push({ from: at, to: stop, text: text.slice(at, stop).replace(/\r$/, '') })
    at = stop + 1
  }
  return out
}

const HEADING = /^ {0,3}#{1,6}(?:\s|$)/
const ROW = /^\s*\|/
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s/
const QUOTE = /^\s{0,3}>/

const LEAD: Partial<Record<BlockKind, RegExp>> = {
  item: /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/,
  heading: /^ {0,3}#{1,6}\s*/,
  quote: /^\s{0,3}>\s?/,
  row: /^\s*\|\s*/,
}

const ROW_END = /\s*\|?\s*$/

export function contentOf(text: string, block: Block): Block {
  const written = text.slice(block.from, block.to)
  const lead = LEAD[block.kind]?.exec(written)?.[0].length ?? 0
  const trail = block.kind === 'row' ? (ROW_END.exec(written.slice(lead))?.[0].length ?? 0) : 0
  const from = block.from + lead
  return { ...block, from, to: Math.max(from, block.to - trail) }
}

export function blocksOf(text: string): Block[] {
  const out: Block[] = []
  const front = frontMatterBlock(text)
  const start = front ? front.to : 0
  if (front)
    out.push({
      from: 0,
      to: text[front.to - 1] === '\n' ? front.to - 1 : front.to,
      kind: 'front-matter',
    })

  const lines = linesOf(text, start)
  let open: Block | null = null
  const close = () => {
    if (open) out.push(open)
    open = null
  }

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (!line) continue

    if (!line.text.trim()) {
      close()
      continue
    }

    const mark = fenceMark(line.text)
    if (mark) {
      close()
      let end = at + 1
      while (end < lines.length && !closesFence(lines[end]?.text ?? '', mark)) end++
      const last = lines[Math.min(end, lines.length - 1)] ?? line
      out.push({ from: line.from, to: last.to, kind: 'fence' })
      at = end
      continue
    }

    const own: BlockKind | null = HEADING.test(line.text)
      ? 'heading'
      : ROW.test(line.text)
        ? 'row'
        : ITEM.test(line.text)
          ? 'item'
          : null

    if (own === 'heading' || own === 'row') {
      close()
      out.push({ from: line.from, to: line.to, kind: own })
      continue
    }

    if (own === 'item') {
      close()
      open = { from: line.from, to: line.to, kind: 'item' }
      continue
    }

    const kind: BlockKind = QUOTE.test(line.text) ? 'quote' : 'paragraph'
    if (open && (open.kind === kind || open.kind === 'item' || kind === 'paragraph')) {
      open.to = line.to
      continue
    }

    close()
    open = { from: line.from, to: line.to, kind }
  }

  close()
  return out
}
