import { readTask } from '@orden/markdown/task-line'

export function taskHash(text: string): string {
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function lineOfTask(
  text: string,
  anchor: { line: number; hash: string },
): { from: number; to: number } | null {
  const lines: { from: number; to: number }[] = []
  for (let from = 0; from <= text.length;) {
    const end = text.indexOf('\n', from)
    const stop = end === -1 ? text.length : end
    lines.push({ from, to: text[stop - 1] === '\r' ? stop - 1 : stop })
    if (end === -1) break
    from = end + 1
  }

  const names = (at: number) => {
    const line = lines[at]
    if (!line) return false
    const fields = readTask(text.slice(line.from, line.to))
    return fields !== null && taskHash(fields.text) === anchor.hash
  }

  for (let distance = 0; distance < lines.length; distance++) {
    if (names(anchor.line - distance)) return lines[anchor.line - distance] ?? null
    if (distance && names(anchor.line + distance)) return lines[anchor.line + distance] ?? null
  }
  return null
}
