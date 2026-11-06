import { frontMatterBlock } from '@orden/markdown/front-matter'
import { lines as rowsOf } from '@orden/markdown/links'

interface Section {
  at: number
  end: number
  level: number
  text: string
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const FENCE = /^[ \t]*(`{3,}|~{3,})/

function wordsLine(text: string): number {
  const block = frontMatterBlock(text)
  return block ? text.slice(0, block.close).split('\n').length : 0
}

function sectionsOf(lines: readonly string[]): Section[] {
  const out: Section[] = []
  for (const row of rowsOf(lines.join('\n'))) {
    if (row.code || row.matter) continue
    const found = HEADING.exec(row.text)
    if (found)
      out.push({
        at: row.line,
        end: lines.length,
        level: found[1]?.length ?? 1,
        text: found[2] ?? '',
      })
  }
  for (const [index, one] of out.entries()) {
    const next = out.slice(index + 1).find((other) => other.level <= one.level)
    if (next) one.end = next.at
  }
  return out
}

export function isTitle(heading: string, note: string): boolean {
  return heading.trim().toLowerCase() === note.trim().toLowerCase()
}

function find(lines: readonly string[], name: string): Section | null {
  return sectionsOf(lines).find((one) => one.text === name) ?? null
}

function settled(lines: readonly string[]): string[] {
  const out = [...lines]
  while (out.length && out.at(-1)?.trim() === '') out.pop()
  return out.length ? [...out, ''] : out
}

function levelFor(lines: readonly string[], after: Section | null, note: string): number {
  if (after) return after.level
  const last = sectionsOf(lines).filter((one) => !(one.level === 1 && isTitle(one.text, note)))
  return last.at(-1)?.level ?? 2
}

export function withSection(
  text: string,
  name: string,
  after: string | null,
  note: string,
): string | null {
  const words = name.trim()
  if (!words) return null
  const lines = text.split('\n')
  const behind = after === null ? null : find(lines, after)
  if (after !== null && !behind) return null
  const heading = `${'#'.repeat(levelFor(lines, behind, note))} ${words}`
  if (!behind) {
    const head = settled(lines)
    return [...head, heading, ''].join('\n')
  }
  const head = settled(lines.slice(0, behind.end))
  const tail = lines.slice(behind.end)
  return [...head, heading, '', ...tail].join('\n').replace(/\n+$/, '\n')
}

export function renamedSection(text: string, from: string, to: string): string | null {
  const words = to.trim()
  const lines = text.split('\n')
  const found = find(lines, from)
  if (!found || !words || words === from) return null
  lines[found.at] = `${'#'.repeat(found.level)} ${words}`
  return lines.join('\n')
}

export function cutSection(text: string, name: string): { rest: string; block: string[] } | null {
  const lines = text.split('\n')
  const found = find(lines, name)
  if (!found) return null
  const block = settled(lines.slice(found.at, found.end))
  const rest = [...lines.slice(0, found.at), ...lines.slice(found.end)]
  return { rest: rest.join('\n'), block }
}

export function duplicatedSection(text: string, name: string, copy: string): string | null {
  const lines = text.split('\n')
  const found = find(lines, name)
  if (!found) return null
  const block = settled(lines.slice(found.at, found.end))
  block[0] = `${'#'.repeat(found.level)} ${copy}`
  const copied = block.map((line, at) => (at === 0 ? line : line.replace(/\s\^[\w-]+\s*$/, '')))
  const head = settled(lines.slice(0, found.end))
  return [...head, ...copied, ...lines.slice(found.end)].join('\n')
}

export function movedSection(text: string, name: string, up: boolean): string | null {
  const lines = text.split('\n')
  const all = sectionsOf(lines)
  const found = all.find((one) => one.text === name)
  if (!found) return null
  const siblings = all.filter((one) => one.level === found.level)
  const other = siblings[siblings.indexOf(found) + (up ? -1 : 1)]
  if (!other) return null
  const [first, second] = up ? [other, found] : [found, other]
  if (first.end !== second.at) return null
  const take = (one: Section) => settled(lines.slice(one.at, one.end))
  const after = lines.slice(second.end)
  const swapped = [...take(second), ...take(first)]
  if (!after.length) while (swapped.at(-1) === '') swapped.pop()
  return [...lines.slice(0, first.at), ...swapped, ...after].join('\n') + (after.length ? '' : '\n')
}

export function withBlock(text: string, block: readonly string[]): string {
  return [...settled(text.split('\n')), ...block].join('\n').replace(/\n*$/, '\n')
}

export function aboutOf(text: string, note: string): string | null {
  const lines = text.split('\n')
  let at = wordsLine(text)
  const words: string[] = []
  for (; at < lines.length; at++) {
    const line = lines[at]?.trim() ?? ''
    const heading = HEADING.exec(line)
    if (heading) {
      if (!words.length && heading[1] === '#' && isTitle(heading[2] ?? '', note)) continue
      break
    }
    if (/^([-*+]|\d+[.)])\s/.test(line) || FENCE.test(line)) break
    if (line) words.push(line)
    else if (words.length) break
  }
  return words.length ? words.join(' ') : null
}

export function retitled(text: string, from: string, to: string): string | null {
  const lines = text.split('\n')
  let at = wordsLine(text)
  while (at < lines.length && lines[at]?.trim() === '') at++
  const found = HEADING.exec(lines[at] ?? '')
  if (found?.[1] !== '#' || !isTitle(found[2] ?? '', from)) return null
  lines[at] = `# ${to.trim()}`
  return lines.join('\n')
}

export function placedSection(
  text: string,
  name: string,
  target: string,
  after: boolean,
): string | null {
  if (name === target) return null
  const lines = text.split('\n')
  const all = sectionsOf(lines)
  const moving = all.find((one) => one.text === name)
  const beside = all.find((one) => one.text === target)
  if (!moving || !beside) return null
  if (beside.at >= moving.at && beside.at < moving.end) return null
  if (moving.at >= beside.at && moving.at < beside.end && after) return null
  const block = settled(lines.slice(moving.at, moving.end))
  const rest = [...lines.slice(0, moving.at), ...lines.slice(moving.end)]
  const there = sectionsOf(rest).find((one) => one.text === target)
  if (!there) return null
  const at = after ? there.end : there.at
  const head = settled(rest.slice(0, at))
  const tail = rest.slice(at)
  const out = [...head, ...block, ...tail]
  while (out.length > 1 && out.at(-1) === '' && out.at(-2) === '') out.pop()
  return out.join('\n')
}
