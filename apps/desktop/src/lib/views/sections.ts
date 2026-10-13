/** A project's sections, the nib way: a section is a heading of the project's note, and
 *  what it holds is every line under it up to the next heading as high or higher. So a
 *  section added, renamed, duplicated, moved up or down, taken to another project or
 *  deleted is a heading and its lines, written as the note's words; the writer turns the
 *  two versions into one edit, which is one undo (act.ts).
 *
 *  Headings inside a fenced block are words, not sections. A note's title - an H1 named
 *  as the note is, at its top - holds the whole note and is no section (`isTitle`).
 *
 *  Pure: a note's words in, its words after out, or null where the section is not there. */

interface Section {
  /** The heading's line. */
  at: number
  /** The first line past what it holds. */
  end: number
  level: number
  text: string
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const FENCE = /^[ \t]*(`{3,}|~{3,})/

/** Every heading of a note with what it holds, in order. */
function sectionsOf(lines: readonly string[]): Section[] {
  const out: Section[] = []
  let fence: string | null = null
  lines.forEach((line, at) => {
    const opens = FENCE.exec(line)?.[1]
    if (opens !== undefined) {
      if (fence === null) fence = opens[0] ?? null
      else if (opens.startsWith(fence)) fence = null
      return
    }
    if (fence !== null) return
    const found = HEADING.exec(line)
    if (found)
      out.push({ at, end: lines.length, level: found[1]?.length ?? 1, text: found[2] ?? '' })
  })
  for (const [index, one] of out.entries()) {
    const next = out.slice(index + 1).find((other) => other.level <= one.level)
    if (next) one.end = next.at
  }
  return out
}

/** Whether a heading is the note's title: an H1 at its top, named as the note is. */
export function isTitle(heading: string, note: string): boolean {
  return heading.trim().toLowerCase() === note.trim().toLowerCase()
}

function find(lines: readonly string[], name: string): Section | null {
  return sectionsOf(lines).find((one) => one.text === name) ?? null
}

/** The lines without trailing blank ones, then one blank line, for a section put after. */
function settled(lines: readonly string[]): string[] {
  const out = [...lines]
  while (out.length && out.at(-1)?.trim() === '') out.pop()
  return out.length ? [...out, ''] : out
}

/** The level a new section is written at: its neighbour's, else the note's last
 *  section's, else two, under a title or none. */
function levelFor(lines: readonly string[], after: Section | null, note: string): number {
  if (after) return after.level
  const last = sectionsOf(lines).filter((one) => !(one.level === 1 && isTitle(one.text, note)))
  return last.at(-1)?.level ?? 2
}

/** The note with a new, empty section: after the one named (past what it holds), or at
 *  the end. */
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

/** The note with a section named again, its level and what it holds as they were. */
export function renamedSection(text: string, from: string, to: string): string | null {
  const words = to.trim()
  const lines = text.split('\n')
  const found = find(lines, from)
  if (!found || !words || words === from) return null
  lines[found.at] = `${'#'.repeat(found.level)} ${words}`
  return lines.join('\n')
}

/** A section and everything it holds, taken out: the note without it, and its lines. */
export function cutSection(text: string, name: string): { rest: string; block: string[] } | null {
  const lines = text.split('\n')
  const found = find(lines, name)
  if (!found) return null
  const block = settled(lines.slice(found.at, found.end))
  const rest = [...lines.slice(0, found.at), ...lines.slice(found.end)]
  return { rest: rest.join('\n'), block }
}

/** The note with a section written again under itself, named `copy`, tasks and all. */
export function duplicatedSection(text: string, name: string, copy: string): string | null {
  const lines = text.split('\n')
  const found = find(lines, name)
  if (!found) return null
  const block = settled(lines.slice(found.at, found.end))
  block[0] = `${'#'.repeat(found.level)} ${copy}`
  // A block name belongs to one block, so the copy's tasks are left without theirs.
  const copied = block.map((line, at) => (at === 0 ? line : line.replace(/\s\^[\w-]+\s*$/, '')))
  const head = settled(lines.slice(0, found.end))
  return [...head, ...copied, ...lines.slice(found.end)].join('\n')
}

/** The note with a section past its sibling above or below it; null where it is first
 *  or last of its level. */
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

/** A note's words with a section's lines added at its end, for one moved in. */
export function withBlock(text: string, block: readonly string[]): string {
  return [...settled(text.split('\n')), ...block].join('\n').replace(/\n*$/, '\n')
}

/** What a project says about itself, Todoist's project description: the words at the
 *  top of its note, past its properties and its title, up to the first task, list or
 *  section. Null where it says nothing. */
export function aboutOf(text: string, note: string): string | null {
  const lines = text.split('\n')
  let at = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    at = end === -1 ? lines.length : end + 1
  }
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

/** The note with its title named again with the project: an H1 at its top that said the
 *  old name says the new one. Null where it has no such title. */
export function retitled(text: string, from: string, to: string): string | null {
  const lines = text.split('\n')
  let at = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
    at = end === -1 ? lines.length : end + 1
  }
  while (at < lines.length && lines[at]?.trim() === '') at++
  const found = HEADING.exec(lines[at] ?? '')
  if (found?.[1] !== '#' || !isTitle(found[2] ?? '', from)) return null
  lines[at] = `# ${to.trim()}`
  return lines.join('\n')
}
