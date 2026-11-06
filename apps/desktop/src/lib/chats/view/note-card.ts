import { CodeBlocks, WORDS } from '@orden/markdown/fences'
import { stripFrontMatter } from '@orden/markdown/front-matter'

const LINES = 2

const LONGEST = 160

function plain(line: string): string {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, '')
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) =>
      (alias ?? target).trim(),
    )
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|==|\*|_|`)(.+?)\1/g, '$2')
    .trim()
}

export function cardLines(text: string, name: string): string[] {
  const lines: string[] = []
  const code = new CodeBlocks()
  for (const raw of stripFrontMatter(text).split('\n')) {
    if (code.line(raw) !== WORDS) continue
    const line = plain(raw)
    if (!line || (lines.length === 0 && line.toLowerCase() === name.toLowerCase())) continue
    lines.push(line.length > LONGEST ? `${line.slice(0, LONGEST)}…` : line)
    if (lines.length === LINES) break
  }
  return lines
}

export function cardTarget(body: string): string | null {
  const words = body.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '')
  for (const found of words.matchAll(/(!?)\[\[([^\]|#^]+)[^\]]*\]\]/g)) {
    const start = words.lastIndexOf('\n', found.index) + 1
    if (found[1] || words.slice(start, found.index).trimStart().startsWith('>')) continue
    const target = found[2]?.trim()
    if (target) return target
  }
  return null
}
