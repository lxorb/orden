import type { Part, Turn } from '../chat/types'

export type FileChange =
  | { id: string; kind: 'moved'; from: string; path: string; space?: string }
  | { id: string; kind: 'trashed'; path: string; space?: string }

type Tool = Extract<Part, { kind: 'tool' }>

export function verbOf(name: string): string {
  const at = name.lastIndexOf('__')
  return at < 0 ? name : name.slice(at + 2)
}

export function answerOf(part: Tool): Record<string, unknown> | null {
  try {
    const read: unknown = JSON.parse(part.result?.text ?? '')
    return typeof read === 'object' && read !== null ? (read as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function argsOf(part: Tool): Record<string, unknown> {
  return typeof part.args === 'object' && part.args !== null
    ? (part.args as Record<string, unknown>)
    : {}
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function spaceOfCall(part: Tool): string {
  return text(answerOf(part)?.space) || text(argsOf(part).space)
}

export function spaceNamed<T extends { id: string; name: string }>(
  spaces: readonly T[],
  named: string,
): T | undefined {
  const folded = named.trim().toLowerCase()
  return (
    spaces.find((one) => one.id === named) ??
    spaces.find((one) => one.name === named) ??
    spaces.find((one) => one.name.toLowerCase() === folded)
  )
}

export function fileChangeOf(part: Tool): FileChange | null {
  if (part.state !== 'ok') return null
  const verb = verbOf(part.verb)
  const said = answerOf(part)
  const space = spaceOfCall(part)
  const where = space ? { space } : {}
  if (verb === 'move_file') {
    const from = text(said?.from)
    const to = text(said?.to)
    return from && to && from !== to
      ? { id: part.id, kind: 'moved', from, path: to, ...where }
      : null
  }
  if (verb === 'trash_file' && said?.trashed === true) {
    const path = text(said.path)
    return path ? { id: part.id, kind: 'trashed', path, ...where } : null
  }
  return null
}

export function fileChangesOf(turns: readonly Turn[], done: ReadonlySet<string>): FileChange[] {
  return turns
    .flatMap((turn) => turn.parts)
    .flatMap((part) => (part.kind === 'tool' ? [fileChangeOf(part)] : []))
    .filter((one): one is FileChange => one !== null && !done.has(one.id))
}
