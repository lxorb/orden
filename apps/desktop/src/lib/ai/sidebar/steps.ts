import type { Part } from '../chat/types'
import { verbOf } from './verbs'

type Notice = Extract<Part, { kind: 'notice' }>
type Tool = Extract<Part, { kind: 'tool' }>
type Row = Extract<Part, { kind: 'thinking' | 'tool' }>

export type Block =
  | { kind: 'words'; text: string; at: number }
  | { kind: 'notice'; notice: Notice; at: number }
  | { kind: 'row'; row: Row; at: number }
  | { kind: 'explored'; rows: Tool[]; at: number }

const LOOKING = new Set(['Read', 'Searched', 'Listed', 'Checked'])

function looks(part: Part): part is Tool {
  return part.kind === 'tool' && part.state !== 'asking' && LOOKING.has(verbOf(part.verb) ?? '')
}

export function blocksOf(parts: readonly Part[]): Block[] {
  const out: Block[] = []
  parts.forEach((part, at) => {
    const before = out.at(-1)
    if (part.kind === 'text') {
      if (before?.kind === 'words') before.text += part.text
      else out.push({ kind: 'words', text: part.text, at })
    } else if (part.kind === 'notice') out.push({ kind: 'notice', notice: part, at })
    else if (looks(part) && before?.kind === 'explored') before.rows.push(part)
    else if (looks(part) && before?.kind === 'row' && looks(before.row))
      out[out.length - 1] = { kind: 'explored', rows: [before.row, part], at: before.at }
    else out.push({ kind: 'row', row: part, at })
  })
  return out
}

export function foldOf(
  blocks: readonly Block[],
  live: boolean,
): { before: Block[]; work: Block[]; after: Block[] } {
  const first = blocks.findIndex((one) => one.kind === 'row' || one.kind === 'explored')
  const called = blocks.some(
    (one) => one.kind === 'explored' || (one.kind === 'row' && one.row.kind === 'tool'),
  )
  const said = (one: Block | undefined) => one?.kind === 'words' && one.text.trim() !== ''
  let last = blocks.length - 1
  while (last >= 0 && !said(blocks[last])) last--
  if (live || !called || first < 0 || last < first)
    return { before: [...blocks], work: [], after: [] }
  return {
    before: blocks.slice(0, first),
    work: blocks.slice(first, last),
    after: blocks.slice(last),
  }
}
