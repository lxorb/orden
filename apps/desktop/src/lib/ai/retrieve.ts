import { frontMatterBlock } from '@orden/markdown/front-matter'
import type { Hit } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
import { searchSpace } from '../search/src/api'
import { waited } from '../platform/src/api'
import type { Message } from '../ai-providers/src/api'

export interface Passage {
  path: string
  name: string
  line: number
  text: string
}

const MOST_NOTES = 6
const MOST_PASSAGES = 10

const BUDGET = 3000
const PER_NOTE = 700
const FRONT_BUDGET = 1500
const SELECTION_BUDGET = 800

const MOST_LINES = 400
const DEADLINE = 1500

const AROUND = 3

export function tokensIn(text: string): number {
  return Math.ceil(text.length / 4)
}

export function fitted(text: string, tokens: number): string {
  if (tokensIn(text) <= tokens) return text

  const room = tokens * 4
  const cut = text.slice(0, room)
  const lastBreak = cut.lastIndexOf('\n')
  return lastBreak > room / 2 ? cut.slice(0, lastBreak) : cut
}

const STOP = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how i if in' +
    ' into is it its me my no not of on or our should so than that the their them then there' +
    ' these they this to was we were what when where which who why will with would you your' +
    ' about all any tell show give find summarise summarize note notes' +
    ' der die das den dem des ein eine einer einen und oder ist sind war wie was wo wer warum' +
    ' ich du er sie es wir ihr mit von zu im in am an auf für nicht auch noch nur mein meine' +
    ' dass über welche welcher welches gibt habe hat haben kann können notiz notizen'
  ).split(' '),
)

export function searchWords(question: string, most = 8): string[] {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_#-]+/u)
    .map((one) => one.replace(/^-+|-+$/g, ''))
    .filter((one) => !/^.?$/su.test(one) && !STOP.has(one))

  const seen = [...new Set(words)]
  const kept = new Set(
    [...seen]
      .sort((one, other) => other.length - one.length || (one < other ? -1 : 1))
      .slice(0, most),
  )

  return seen.filter((one) => kept.has(one))
}

export function queryFor(words: readonly string[]): Query {
  return { kind: 'any', of: words.map((text) => ({ kind: 'text', text, fold: true })) }
}

export interface Ranked {
  path: string
  name: string
  score: number
  lines: number[]
}

export function ranked(hits: readonly Hit[], words: readonly string[]): Ranked[] {
  const notes = new Map<string, { name: string; lines: Set<number>; said: Map<string, number> }>()

  for (const hit of hits) {
    if (hit.page !== undefined) continue

    const held = notes.get(hit.path) ?? { name: hit.name, lines: new Set(), said: new Map() }
    if (hit.ranges.length) held.lines.add(hit.line)

    const line = hit.text.toLowerCase()
    const name = hit.name.toLowerCase()
    for (const word of words) {
      const worth = name.includes(word) ? 2 : line.includes(word) ? 1 : 0
      if (worth > (held.said.get(word) ?? 0)) held.said.set(word, worth)
    }

    notes.set(hit.path, held)
  }

  const saying = new Map<string, number>()
  for (const held of notes.values()) {
    for (const word of held.said.keys()) saying.set(word, (saying.get(word) ?? 0) + 1)
  }

  const count = notes.size
  return [...notes]
    .map(([path, held]) => ({
      path,
      name: held.name,
      score: [...held.said].reduce(
        (sum, [word, worth]) => sum + worth * Math.log(1 + count / (saying.get(word) ?? 1)),
        0,
      ),
      lines: [...held.lines].sort((one, other) => one - other),
    }))
    .sort(
      (one, other) =>
        other.score - one.score ||
        other.lines.length - one.lines.length ||
        (one.path < other.path ? -1 : 1),
    )
}

export function linesSaying(text: string, words: readonly string[]): number[] {
  if (!words.length) return []

  const out: number[] = []
  text.split('\n').forEach((line, at) => {
    const folded = line.toLowerCase()
    if (words.some((word) => folded.includes(word))) out.push(at)
  })
  return out
}

function firstLine(text: string): number {
  const block = frontMatterBlock(text)
  return block ? text.slice(0, block.to).split('\n').length - 1 : 0
}

export function passagesOf(
  note: { path: string; name: string; text: string },
  lines: readonly number[],
  tokens: number,
): Passage[] {
  const rows = note.text.split('\n')
  const start = firstLine(note.text)
  const head = (): Passage[] => {
    const text = fitted(rows.slice(start).join('\n').trim(), tokens)
    return text ? [{ path: note.path, name: note.name, line: start, text }] : []
  }

  const matched = lines.filter((one) => one >= start && one < rows.length)
  if (!matched.length) return head()

  const runs: { from: number; to: number; line: number }[] = []
  for (const line of matched) {
    const from = Math.max(start, line - AROUND)
    const to = Math.min(rows.length - 1, line + AROUND)
    const last = runs.at(-1)

    if (last && from <= last.to + 1) last.to = Math.max(last.to, to)
    else runs.push({ from, to, line })
  }

  const out: Passage[] = []
  let left = tokens
  for (const run of runs) {
    if (left <= 0) break
    const text = fitted(
      rows
        .slice(run.from, run.to + 1)
        .join('\n')
        .trim(),
      left,
    )
    if (!text) continue

    out.push({ path: note.path, name: note.name, line: run.line, text })
    left -= tokensIn(text)
  }

  return out
}

export function frontPassages(
  note: { path: string; name: string; text: string },
  words: readonly string[],
): Passage[] {
  const lines = linesSaying(note.text, words)
  const start = firstLine(note.text)
  const body = note.text.split('\n').slice(start).join('\n').trim()
  if (!body) return []

  if (tokensIn(body) > FRONT_BUDGET) return passagesOf(note, lines, FRONT_BUDGET)

  const line = lines.find((one) => one >= start) ?? start
  return [{ path: note.path, name: note.name, line, text: body }]
}

export interface Space {
  root: string
  excluded: readonly string[]
  relative: (path: string) => string | null
  read: (path: string) => Promise<string | null>
  search?: typeof searchSpace
  deadline?: number
}

export async function retrieve(
  question: string,
  space: Space,
  front: { path: string; name: string; text: string } | null,
): Promise<Passage[]> {
  const words = searchWords(question)
  const own = front ? frontPassages(front, words) : []
  if (!words.length) return own

  const hits: Hit[] = []
  let open = true
  const search = space.search ?? searchSpace
  const asked = search(
    space.root,
    queryFor(words),
    [],
    MOST_LINES,
    (found) => {
      if (open) hits.push(...found.hits)
    },
    space.excluded,
  ).catch(() => undefined)

  await Promise.race([asked, waited(space.deadline ?? DEADLINE)])
  open = false

  const out = [...own]
  let spent = 0
  for (const note of ranked(hits, words).slice(0, MOST_NOTES + 1)) {
    if (spent >= BUDGET || out.length >= MOST_PASSAGES) break

    const path = space.relative(note.path)
    if (path === null || path === front?.path) continue

    const text = await space.read(note.path)
    if (text === null) continue

    const name = note.name.replace(/\.(?:md|markdown)$/i, '')
    const found = passagesOf({ path, name, text }, note.lines, Math.min(PER_NOTE, BUDGET - spent))
    for (const passage of found.slice(0, MOST_PASSAGES - out.length)) {
      out.push(passage)
      spent += tokensIn(passage.text)
    }
  }

  return out
}

export function contextFor(passages: readonly Passage[], selection: string): Message[] {
  const out: Message[] = []

  if (passages.length) {
    const blocks = passages.map(
      (one, at) =>
        `<passage n="${at + 1}" note="${one.name.replace(/"/g, "'")}" line="${one.line + 1}">\n${one.text}\n</passage>`,
    )
    out.push({
      role: 'system',
      content: `Passages from the reader's notes:\n\n${blocks.join('\n\n')}`,
    })
  }

  if (selection.trim()) {
    out.push({
      role: 'system',
      content: `What the reader has selected in the note in front:\n\n<selection>\n${fitted(selection, SELECTION_BUDGET)}\n</selection>`,
    })
  }

  return out
}

const CITATION = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g

const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/

export function citationLinks(answer: string, count: number): string {
  return answer
    .split(CODE)
    .map((part, at) =>
      at % 2
        ? part
        : part.replace(CITATION, (whole, numbers: string) => {
            const cited = numbers.split(',').map((one) => Number(one.trim()))
            if (cited.some((one) => one < 1 || one > count)) return whole
            return cited.map((one) => `[${one}](#cite-${one})`).join('')
          }),
    )
    .join('')
}

export function citedIn(answer: string, count: number): number[] {
  const out: number[] = []
  for (const part of answer.split(CODE).filter((_part, at) => at % 2 === 0)) {
    for (const match of part.matchAll(CITATION)) {
      for (const one of (match[1] ?? '').split(',')) {
        const cited = Number(one.trim())
        if (cited >= 1 && cited <= count && !out.includes(cited)) out.push(cited)
      }
    }
  }
  return out
}

export function uncited(answer: string): string {
  return answer.replace(/ ?\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, '')
}

function linkTo(source: { path: string; name: string }): string {
  const stem = source.path.replace(/\.(?:md|markdown)$/i, '')
  return stem === source.name ? `[[${stem}]]` : `[[${stem}|${source.name}]]`
}

export function linkedAnswer(
  answer: string,
  sources: readonly { path: string; name: string }[],
  cite: (source: { path: string; name: string }) => string = linkTo,
): string {
  return answer
    .split(CODE)
    .map((part, at) => {
      if (at % 2) return part
      const said: string[] = []
      const mark = (words: string) => {
        if (!said.includes(words)) said.push(words)
        return `\uE000${said.indexOf(words)}\uE001`
      }
      const marked = part.replace(CITATION, (whole, numbers: string) => {
        const notes = numbers
          .split(',')
          .map((one) => sources[Number(one.trim()) - 1])
          .filter((one) => one !== undefined)
          .map(cite)
        return notes.length ? [...new Set(notes)].map(mark).join(' ') : whole
      })
      const folded = marked.replace(/(\uE000(\d+)\uE001)(?:\s*\uE000\2\uE001)+/g, '$1')
      return said
        .reduce((out, words, at) => {
          const name = words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          return out.replace(
            new RegExp(`(?<![\\p{L}\\p{N}_])(${name})\\s*\uE000${at}\uE001`, 'gu'),
            '$1',
          )
        }, folded)
        .replace(/\uE000(\d+)\uE001/g, (whole, at: string) => said[Number(at)] ?? whole)
        .replace(/(\[\[[^\]]+\]\])(?:\s*\1)+/g, '$1')
    })
    .join('')
}
