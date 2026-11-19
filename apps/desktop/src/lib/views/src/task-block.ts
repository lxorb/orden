import { lineOfTask } from '@orden/bases'
import { changedTask } from '@orden/markdown/task-edits'
import { readTask } from '@orden/markdown/task-line'

interface Anchor {
  line: number
  hash: string
}
const indentOf = (text: string) => /^[ \t]*/.exec(text)?.[0].replace(/\t/g, '    ').length ?? 0
function lineAt(text: string, anchor: Anchor): number | null {
  const span = lineOfTask(text, anchor)
  return span === null ? null : text.slice(0, span.from).split('\n').length - 1
}
function blockAt(lines: readonly string[], index: number): [number, number] {
  const own = indentOf(lines[index] ?? '')
  let end = index + 1
  while (end < lines.length) {
    const text = lines[end] ?? ''
    if (text.trim() === '') {
      const next = lines.slice(end + 1).find((one) => one.trim() !== '')
      if (!next || indentOf(next) <= own) break
    } else if (indentOf(text) <= own) break
    end++
  }
  return [index, end]
}
function copiedLine(line: string): string {
  const unblocked = line.replace(/[ \t]\^[\w-]+[ \t]*(\r?)$/, '$1')
  const end = unblocked.endsWith('\r') ? '\r' : ''
  const text = end ? unblocked.slice(0, -1) : unblocked
  return readTask(text)?.id === undefined ? unblocked : `${changedTask(text, { id: null })}${end}`
}
export function withoutTask(text: string, anchor: Anchor): string | null {
  const index = lineAt(text, anchor)
  if (index === null) return null
  const lines = text.split('\n')
  const [from, to] = blockAt(lines, index)
  lines.splice(from, to - from)
  return lines.join('\n')
}
export function duplicatedTask(text: string, anchor: Anchor): string | null {
  const index = lineAt(text, anchor)
  if (index === null) return null
  const lines = text.split('\n')
  const [from, to] = blockAt(lines, index)
  const copy = lines.slice(from, to).map(copiedLine)
  lines.splice(to, 0, ...copy)
  return lines.join('\n')
}
