import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import {
  ChangeSet,
  type ChangeSpec,
  type EditorState,
  EditorSelection,
  type Line,
  type SelectionRange,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state'
import { type Callout, calloutOf } from '@orden/markdown/callouts'
import { blockIdOf } from '@orden/markdown/links'
import { taskAt } from '@orden/markdown/tasks'
import { EditorView } from '@codemirror/view'
import { inCode } from './code'
import { marksAcross } from './line-door'
import { noteIndex } from './wikilink/notes'
import { headingLevel } from './headings'
import { enclosing, enclosingNamed } from './nodes'

export function toggleWrap(before: string, after = before): StateCommand {
  const italic = before === '*' && after === '*'
  const across = before === after ? marksAcross(before) : null

  return (target) => {
    const { state, dispatch } = target
    if (across && state.selection.ranges.some((range) => spansLines(state, range))) {
      return across(target)
    }

    const update = state.changeByRange((range) => {
      const { from, to } = inside(state, range.from, range.to)
      const doc = state.doc

      const leading = doc.sliceString(Math.max(0, from - before.length), from)
      const trailing = doc.sliceString(to, Math.min(doc.length, to + after.length))

      const line = doc.lineAt(from)
      const stars = italic
        ? (/\*+$/u.exec(line.text.slice(0, from - line.from))?.[0].length ?? 0)
        : 1

      if (leading === before && trailing === after && stars % 2 === 1) {
        return {
          changes: [
            { from: from - before.length, to: from },
            { from: to, to: to + after.length },
          ],
          range: EditorSelection.range(from - before.length, to - before.length),
        }
      }

      const run = from === to ? runAround(state, from, before, after) : null
      if (run) {
        return {
          changes: [
            { from: run.from, to: run.from + before.length },
            { from: run.to - after.length, to: run.to },
          ],
          range: EditorSelection.cursor(from - before.length),
        }
      }

      const text = doc.sliceString(from, to)

      const held = italic ? (/^\*+/u.exec(text)?.[0].length ?? 0) : 1
      if (
        text.length >= before.length + after.length &&
        text.startsWith(before) &&
        text.endsWith(after) &&
        held % 2 === 1
      ) {
        return {
          changes: { from, to, insert: text.slice(before.length, text.length - after.length) },
          range: EditorSelection.range(from, to - before.length - after.length),
        }
      }

      return {
        changes: { from, to, insert: before + text + after },
        range: EditorSelection.range(from + before.length, to + before.length),
      }
    })

    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

const RUNS: Readonly<Record<string, { node: string; marks: readonly string[] }>> = {
  '**': { node: 'StrongEmphasis', marks: ['**', '__'] },
  '*': { node: 'Emphasis', marks: ['*', '_'] },
  '~~': { node: 'Strikethrough', marks: ['~~'] },
  '`': { node: 'InlineCode', marks: ['`'] },
}

function runAround(
  state: EditorState,
  at: number,
  before: string,
  after: string,
): { from: number; to: number } | null {
  const kind = before === after ? RUNS[before] : undefined
  if (!kind) return null

  const size = before.length
  for (const node of enclosing(syntaxTree(state).resolveInner(at, 0))) {
    if (node.name !== kind.node) continue
    if (at < node.from + size || at > node.to - size) continue

    const opens = state.doc.sliceString(node.from, node.from + size)
    const closes = state.doc.sliceString(node.to - size, node.to)
    const inner = state.doc.sliceString(node.from + size, node.to - size)
    if (opens !== closes || !kind.marks.includes(opens)) continue
    if (kind.node === 'InlineCode' && (inner.startsWith('`') || inner.endsWith('`'))) continue
    return { from: node.from, to: node.to }
  }

  return null
}

function spansLines(state: EditorState, range: SelectionRange): boolean {
  const { from, to } = inside(state, range.from, range.to)
  return state.doc.lineAt(from).number !== state.doc.lineAt(to).number
}

export function inside(state: EditorState, from: number, to: number): { from: number; to: number } {
  const text = state.doc.sliceString(from, to)
  const kept = text.trim()
  if (!kept) return { from, to }

  const start = from + text.indexOf(kept)
  const end = start + kept.length
  const line = state.doc.lineAt(end)
  const id = blockIdOf(line.text)
  if (!id || end !== line.from + line.text.trimEnd().length) return { from: start, to: end }

  const words = state.doc.sliceString(start, end - id.length - 1).trimEnd()
  return { from: start, to: words ? start + words.length : end }
}

export interface Lines {
  first: number
  last: number
}

export function linesOf(state: EditorState, from: number, to: number): Lines {
  const first = state.doc.lineAt(from).number
  const end = state.doc.lineAt(to)
  const last = to > from && to === end.from && end.number > first ? end.number - 1 : end.number
  return { first, last }
}

export function selectedLines(state: Parameters<StateCommand>[0]['state']) {
  const numbers = new Set<number>()

  for (const range of state.selection.ranges) {
    const { first, last } = linesOf(state, range.from, range.to)
    for (let line = first; line <= last; line++) numbers.add(line)
  }

  return [...numbers].map((number) => state.doc.line(number))
}

const HEADING = /^(#{1,6})\s+/

function headingOf(text: string): { level: number; length: number } {
  const match = HEADING.exec(text)
  const hashes = match?.[1]
  if (!match || hashes === undefined) return { level: 0, length: 0 }
  return { level: hashes.length, length: match[0].length }
}

interface Words {
  from: number
  text: string
}

function wordsOfLine(line: Line): Words {
  const quote = (QUOTED.exec(line.text)?.[0] ?? '').length
  return { from: line.from + quote, text: line.text.slice(quote) }
}

export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state).map(wordsOfLine)
    const already = level > 0 && lines.every((line) => headingOf(line.text).level === level)
    const insert = level && !already ? `${'#'.repeat(level)} ` : ''

    const changes: ChangeSpec[] = lines.map((line) => {
      const item = insert ? (ITEM_MARKER.exec(line.text)?.[0].length ?? 0) : 0
      return { from: line.from, to: line.from + (item || headingOf(line.text).length), insert }
    })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

const ITEM_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/

export function shiftHeading(delta: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = selectedLines(state)
      .map(wordsOfLine)
      .map((line) => {
        const existing = headingOf(line.text)
        const next = Math.min(6, Math.max(0, existing.level + delta))

        return {
          from: line.from,
          to: line.from + existing.length,
          insert: next ? `${'#'.repeat(next)} ` : '',
        }
      })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

function toggleLinePrefix(prefix: string, pattern: RegExp): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state)
    const allPrefixed = lines.every((line) => pattern.test(line.text))

    const changes: ChangeSpec[] = lines.map((line) => {
      const existing = pattern.exec(line.text)
      const matched = existing?.[0] ?? ''
      const indent = matched.length - matched.trimStart().length

      if (allPrefixed && existing) {
        const task = taskAt(line.text)
        const end = task ? Math.max(task.marker, matched.length) : matched.length
        return { from: line.from + indent, to: line.from + end, insert: '' }
      }
      return { from: line.from + indent, to: line.from + matched.length, insert: prefix }
    })

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

const MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/

export const toggleQuote = toggleLinePrefix('> ', /^>\s?/)
const INDENT = /^\s*/

const QUOTED = /^(?:[ \t]*>[ \t]?)*/

export const toggleTaskList: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state).map((line) => {
    const quote = (QUOTED.exec(line.text)?.[0] ?? '').length
    return { from: line.from + quote, text: line.text.slice(quote) }
  })
  const allTasks = lines.every((line) => taskAt(line.text) !== null)

  const changes: ChangeSpec[] = lines.map((line) => {
    const task = taskAt(line.text)
    const indent = task?.indent ?? (INDENT.exec(line.text)?.[0] ?? '').length

    if (allTasks && task) {
      return { from: line.from + indent, to: line.from + task.marker, insert: '' }
    }

    const marker = task ? task.marker : MARKER.exec(line.text)?.[0].length
    return {
      from: line.from + indent,
      to: line.from + (marker ?? indent),
      insert: '- [ ] ',
    }
  })

  dispatch(state.update({ changes, userEvent: 'input' }))
  return true
}

const NO_TASK_HERE = new Set([
  'Table',
  'Blockquote',
  'HTMLBlock',
  'CommentBlock',
  'FrontMatter',
  'BlockMath',
  'LinkReference',
  'HorizontalRule',
])

function taskable(state: EditorState, line: Line): boolean {
  if (inCode(state, line.from)) return false
  for (const node of enclosing(syntaxTree(state).resolveInner(line.from, 1))) {
    if (NO_TASK_HERE.has(node.name) || headingLevel(node.name) !== null) return false
  }
  return true
}

export const toggleTask: StateCommand = (target) => {
  const { state, dispatch } = target
  const changes: ChangeSpec[] = []
  const help = target instanceof EditorView ? state.facet(noteIndex).tasks : undefined
  const ticking: number[] = []

  for (const line of selectedLines(state)) {
    if (!taskable(state, line)) continue

    const task = taskAt(line.text)
    if (task && help) {
      ticking.push(line.number)
      continue
    }
    if (task) {
      const at = line.from + task.box + 1
      changes.push({ from: at, to: at + 1, insert: task.done ? ' ' : 'x' })
      continue
    }

    const indent = (INDENT.exec(line.text)?.[0] ?? '').length
    const marker = MARKER.exec(line.text)?.[0].length ?? indent
    changes.push({ from: line.from + indent, to: line.from + marker, insert: '- [ ] ' })
  }

  if (ticking.length && help && target instanceof EditorView) {
    void import('./task-tick').then(({ tickLines }) =>
      tickLines(target, help, state.doc, ticking, changes),
    )
    return true
  }
  if (!changes.length) return false

  const set = state.changes(changes)
  dispatch(
    state.update({ changes: set, selection: state.selection.map(set, 1), userEvent: 'input' }),
  )
  return true
}

export const tickTaskAtCaret: StateCommand = (target) => {
  const { state } = target
  const { main } = state.selection
  const line = state.doc.lineAt(main.head)
  if (state.selection.ranges.length > 1 || main.from < line.from || main.to > line.to) return false
  if (!taskAt(line.text) || !taskable(state, line)) return false

  return toggleTask(target)
}

const NUMBERED = /^\s*\d+[.)]\s+/
const BULLETED = /^\s*[-*+]\s+/

interface Parent {
  depth: number
  levels: number[]
  shift: number
}

interface Quoted {
  start: number
  from: number
  depth: number
  leads: string[]
  marks: string[]
  levels: number[]
  text: string
  space: string
  column: number
}

const QUOTE_LEVEL = /([ \t]*)(>[ \t]?)/y

function quotedLine(line: Line): Quoted {
  const leads: string[] = []
  const marks: string[] = []
  let at = 0
  QUOTE_LEVEL.lastIndex = 0
  for (let found = QUOTE_LEVEL.exec(line.text); found; found = QUOTE_LEVEL.exec(line.text)) {
    leads.push(found[1] ?? '')
    marks.push(found[2] ?? '')
    at = QUOTE_LEVEL.lastIndex
  }
  const text = line.text.slice(at)
  const space = INDENT.exec(text)?.[0] ?? ''
  const column = columnOf(space)
  return {
    start: line.from,
    from: line.from + at,
    depth: leads.length,
    leads,
    marks,
    levels: [...leads.map(columnOf), column],
    text,
    space,
    column,
  }
}

function columnOf(space: string): number {
  let column = 0
  for (const character of space)
    column = character === '\t' ? column + 4 - (column % 4) : column + 1
  return column
}

function shiftedSpace(space: string, shift: number): string {
  if (shift > 0) return space + ' '.repeat(shift)
  if (shift === 0) return space
  const trailing = /[ ]*$/.exec(space)?.[0].length ?? 0
  return space.slice(0, space.length - Math.min(trailing, -shift))
}

function encloses(outer: number[], inner: number[], orSibling: boolean): boolean {
  const last = outer.length - 1
  if (last >= inner.length) return false
  for (let at = 0; at < last; at++) if (outer[at] !== inner[at]) return false
  const own = outer[last] ?? 0
  const theirs = inner[last] ?? 0
  return own < theirs || (orSibling && last === inner.length - 1 && own === theirs)
}

function shiftsOf(parents: Parent[], line: Quoted): number[] {
  for (let top = parents.at(-1); top; top = parents.at(-1)) {
    if (encloses(top.levels, line.levels, false)) break
    parents.pop()
  }
  const shifts = Array.from({ length: line.depth + 1 }, () => 0)
  for (const parent of parents) shifts[parent.depth] = parent.shift
  return shifts
}

function prefixOf(line: Quoted, shifts: number[]): string {
  const quote = line.leads.map(
    (lead, at) => shiftedSpace(lead, shifts[at] ?? 0) + (line.marks[at] ?? ''),
  )
  return quote.join('') + shiftedSpace(line.space, shifts[line.depth] ?? 0)
}

function toggleList(own: RegExp, markerFor: (count: number) => string): StateCommand {
  return ({ state, dispatch }) => {
    const chosen = selectedLines(state)
    const quoted = chosen.map(quotedLine)
    const written = quoted.filter((line) => line.text.trim())
    const skipsBlank = written.length > 0
    const lines = skipsBlank ? written : quoted
    const allListed = lines.every((line) => own.test(line.text))

    if (allListed) {
      const changes: ChangeSpec[] = lines.map((line) => {
        const matched = MARKER.exec(line.text)?.[0] ?? ''
        const task = taskAt(line.text)
        const end = task ? Math.max(task.marker, matched.length) : matched.length
        return { from: line.from + line.space.length, to: line.from + end, insert: '' }
      })
      dispatch(state.update({ changes, userEvent: 'input' }))
      return true
    }

    const picked = new Set(chosen.map((line) => line.number))
    const last = chosen.at(-1)?.number ?? 0
    const counts = new Map<string, { levels: number[]; count: number }>()
    const parents: Parent[] = []
    const changes: ChangeSpec[] = []

    const first = chosen[0]?.number ?? 1
    for (let number = first; number <= state.doc.lines; number++) {
      const line = quotedLine(state.doc.line(number))
      if (skipsBlank && !line.text.trim()) continue
      if (!picked.has(number)) {
        if (!line.text.trim()) continue
        const shifts = shiftsOf(parents, line)
        if (!parents.length && number > last) break
        parents.push({ depth: line.depth, levels: line.levels, shift: shifts[line.depth] ?? 0 })
        if (shifts.some(Boolean)) {
          const end = line.from + line.space.length
          changes.push({ from: line.start, to: end, insert: prefixOf(line, shifts) })
        }
        continue
      }

      for (const [key, held] of counts)
        if (!encloses(held.levels, line.levels, true)) counts.delete(key)
      const key = line.levels.join(',')
      const count = (counts.get(key)?.count ?? 0) + 1
      counts.set(key, { levels: line.levels, count })

      const shifts = shiftsOf(parents, line)
      const matched = MARKER.exec(line.text)?.[0] ?? ''
      const marker = markerFor(count)
      const widened = matched ? marker.length - (matched.length - line.space.length) : 0
      const shift = (shifts[line.depth] ?? 0) + widened
      parents.push({ depth: line.depth, levels: line.levels, shift })

      const to = line.from + Math.max(matched.length, line.space.length)
      changes.push({ from: line.start, to, insert: prefixOf(line, shifts) + marker })
    }

    dispatch(state.update({ changes, userEvent: 'input' }))
    return true
  }
}

export const toggleBulletList = toggleList(BULLETED, () => '- ')

export const toggleOrderedList = toggleList(NUMBERED, (count) => `${count}. `)

interface Block {
  text: string
  caret: number
}

interface Room {
  wrap?: (selected: string) => Block
  above?: boolean
  below?: boolean
}

const STRUCTURED = /^\s*(?:[-*+]\s|\d+[.)]\s|>|#{1,6}\s|\|)/

function splitsStructure(state: EditorState, from: number, to: number): boolean {
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  if (from === to && from === first.from) return false

  return (
    (from > first.from && STRUCTURED.test(first.text)) ||
    (to < last.to && STRUCTURED.test(last.text))
  )
}

function roomAbove(state: EditorState, at: number, blank: boolean): string {
  const line = state.doc.lineAt(at)
  if (at > line.from) return blank ? '\n\n' : '\n'
  if (!blank || line.number === 1) return ''

  return state.doc.line(line.number - 1).text.trim() ? '\n' : ''
}

function roomBelow(state: EditorState, at: number, text: string, blank: boolean): string {
  const line = state.doc.lineAt(at)
  if (state.sliceDoc(at, line.to) !== '') {
    if (blank) return '\n\n'
    return text.endsWith('\n') ? '' : '\n'
  }
  if (!blank || line.number === state.doc.lines) return ''

  return state.doc.line(line.number + 1).text.trim() ? '\n' : ''
}

const HOLDS_ITS_LINES: ReadonlySet<string> = new Set(['Table', 'FencedCode', 'BlockMath'])

function insertBlock(build: () => Block, room: Room = {}): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main
    const inTree = syntaxTree(state).resolveInner(range.to, -1)
    const holder = enclosingNamed(inTree, HOLDS_ITS_LINES)
    const quote = !holder && !room.wrap ? enclosingNamed(inTree, 'Blockquote') : null
    const around = holder ?? quote
    const whole = around && (around.from < range.from || around.to > range.to) ? around : null
    const splits = !!whole || splitsStructure(state, range.from, range.to)
    const wrap = splits ? undefined : room.wrap
    const below = whole ? whole.to : splits ? state.doc.lineAt(range.to).to : range.to

    const from = wrap ? range.from : below
    const to = wrap && state.sliceDoc(from, below).endsWith('\n') ? below - 1 : below

    const { text, caret } = wrap && from < to ? wrap(state.sliceDoc(from, to)) : build()
    const prefix = roomAbove(state, from, !!room.above)
    const insert = prefix + text + roomBelow(state, to, text, !!room.below)

    dispatch(
      state.update({
        changes: { from, to, insert },
        selection: { anchor: from + prefix.length + caret },
        scrollIntoView: true,
        userEvent: 'input',
      }),
    )
    return true
  }
}

function fenceFor(words: string): string {
  const longest = words
    .split('\n')
    .map((line) => /^ {0,3}(`+)/.exec(line)?.[1]?.length ?? 0)
    .reduce((high, one) => Math.max(high, one), 2)
  return '`'.repeat(longest + 1)
}

export const insertCodeFence = insertBlock(() => ({ text: '```\n\n```', caret: 3 }), {
  wrap: (selected) => {
    const fence = fenceFor(selected)
    return { text: `${fence}\n${selected}\n${fence}`, caret: fence.length }
  },
})

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

function fenceOf(text: string): { mark: string; info: string } | null {
  const match = FENCE.exec(text)
  const mark = match?.[1]
  const info = match?.[2]
  if (mark === undefined || info === undefined) return null
  if (mark.startsWith('`') && info.includes('`')) return null
  return { mark, info: info.trim() }
}

const EMPTY_QUOTE = /^ {0,3}((?:> ?)+)$/

const VERBATIM = new Set(['HTMLBlock', 'CommentBlock', 'BlockMath'])

function notQuoted(state: EditorState, line: Line): boolean {
  if (inCode(state, line.to, -1)) return true
  return enclosingNamed(syntaxTree(state).resolveInner(line.to, -1), VERBATIM) !== null
}

export const leaveQuote: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const line = state.doc.lineAt(range.head)
  if (range.head !== line.to) return false

  const marks = EMPTY_QUOTE.exec(line.text)?.[1]
  if (marks === undefined || notQuoted(state, line)) return false

  const levels = marks.split('>').length - 1
  const kept = levels > 1 ? `${'> '.repeat(levels - 1).trimEnd()} ` : ''

  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: kept },
      selection: { anchor: line.from + kept.length },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

const CONTAINER = /^(?:[ \t]*>[ \t]?)*(?:[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)?/

function heldIn(prefix: string): string {
  return prefix.replace(/(?:[-*+]|\d{1,9}[.)])(?=[ \t]+$)/, (marker) => ' '.repeat(marker.length))
}

function fenceLine(text: string): { pad: string; rest: string } {
  const prefix = CONTAINER.exec(text)?.[0] ?? ''
  const rest = text.slice(prefix.length)
  return { pad: heldIn(prefix) + (/^ {0,3}/.exec(rest)?.[0] ?? ''), rest }
}

const NOT_PROSE = new Set([
  'CodeBlock',
  'HTMLBlock',
  'CommentBlock',
  'Comment',
  'BlockMath',
  'FrontMatter',
])

function opensUnclosedFence(state: EditorState, line: Line): boolean {
  const tree = ensureSyntaxTree(state, state.doc.length, 50)
  if (!tree) return false
  const here = tree.resolveInner(line.to, -1)
  const code = enclosingNamed(here, 'FencedCode')
  if (!code) return enclosingNamed(here, NOT_PROSE) === null
  if (state.doc.lineAt(code.from).number !== line.number) return false
  return code.getChildren('CodeMark').length < 2
}

export const closeFence: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const line = state.doc.lineAt(range.head)
  if (range.head !== line.to) return false

  const { pad, rest } = fenceLine(line.text)
  const fence = fenceOf(rest)
  if (!fence) return false

  if (!opensUnclosedFence(state, line)) return false

  dispatch(
    state.update({
      changes: { from: line.to, insert: `\n${pad}\n${pad}${fence.mark}` },
      selection: { anchor: line.to + 1 + pad.length },
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

const HOLDERS = new Set(['Blockquote', 'ListItem'])

function heldCode(state: EditorState, pos: number): SyntaxNode | null {
  const code = enclosingNamed(syntaxTree(state).resolveInner(pos, -1), 'FencedCode')
  return code && enclosingNamed(code, HOLDERS) ? code : null
}

export const continueInCode: StateCommand = ({ state, dispatch }) => {
  if (!state.selection.ranges.every((range) => heldCode(state, range.head))) return false

  const update = state.changeByRange((range) => {
    const code = heldCode(state, range.head)
    const opener = state.doc.lineAt(code?.from ?? range.head)
    const line = state.doc.lineAt(range.head)
    const own = fenceLine(line.text)
    const first = line.number === opener.number
    const pad = first
      ? heldIn(opener.text.slice(0, (code?.from ?? opener.from) - opener.from))
      : own.pad
    const indent = first ? '' : (/^[ \t]*/.exec(line.text.slice(own.pad.length))?.[0] ?? '')
    const insert = `\n${pad}${indent}`

    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    }
  })

  dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

export const insertMathBlock = insertBlock(() => ({ text: '$$\n\n$$', caret: 3 }), {
  wrap: (selected) => ({ text: `$$\n${selected}\n$$`, caret: selected.length + 3 }),
})

export const insertChart = insertBlock(() => ({
  text: '```chart\ntype: bar\ntitle: \nlabels: [one, two, three]\nseries:\n  - data: [1, 2, 3]\n```\n',
  caret: 26,
}))

export const insertAiBlock = insertBlock(() => ({ text: '```ai\n\n```\n', caret: 6 }))

export const insertHorizontalRule = insertBlock(() => ({ text: '---\n', caret: 4 }), {
  above: true,
})

export const insertCallout = insertBlock(() => ({ text: '> [!NOTE]\n> ', caret: 12 }), {
  below: true,
  wrap: (selected) => {
    const text = `> [!NOTE]\n${selected
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`
    return { text, caret: text.length }
  },
})

function calloutAt(state: EditorState): { line: Line; at: number; callout: Callout } | null {
  const doc = state.doc

  for (let number = doc.lineAt(state.selection.main.head).number; number >= 1; number--) {
    const line = doc.line(number)
    if (!/^[ \t]*>/.test(line.text)) return null

    const at = line.text.indexOf('[!')
    if (at < 0 || !/^[ \t>]*$/.test(line.text.slice(0, at))) continue

    const callout = calloutOf(line.text.slice(at))
    if (callout) return { line, at, callout }
  }

  return null
}

export function calloutSign(state: EditorState): '+' | '-' | '' | null {
  const found = calloutAt(state)
  if (!found) return null

  return found.callout.foldable ? (found.callout.folded ? '-' : '+') : ''
}

export function setCalloutSign(sign: '+' | '-'): StateCommand {
  return ({ state, dispatch }) => {
    const found = calloutAt(state)
    if (!found) return false

    const { line, at, callout } = found
    const closed = line.text.indexOf(']', at)
    if (closed < 0) return false

    const from = line.from + closed + 1
    const held = callout.foldable ? 1 : 0
    const insert = callout.foldable && (callout.folded ? '-' : '+') === sign ? '' : sign

    dispatch(state.update({ changes: { from, to: from + held, insert }, userEvent: 'input' }))
    return true
  }
}

export const insertToc = insertBlock(() => ({ text: '[toc]\n', caret: 6 }))

export const insertFootnote: StateCommand = ({ state, dispatch }) => {
  const text = state.doc.toString()
  const used = new Set([...text.matchAll(/\[\^([^\]\s]+)\]/g)].map((found) => found[1]))

  let number = 1
  while (used.has(String(number))) number++
  const label = `[^${number}]`

  const end = text.replace(/\s+$/, '').length
  const at = Math.min(state.selection.main.to, end)
  const definition = `\n\n${label}: `

  const changes: ChangeSpec[] =
    at === end
      ? [{ from: end, to: state.doc.length, insert: label + definition }]
      : [
          { from: at, insert: label },
          { from: end, to: state.doc.length, insert: definition },
        ]

  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(end + label.length + definition.length),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

export const insertComment = toggleWrap('<!-- ', ' -->')

export const insertPageBreak = insertBlock(() => ({
  text: '<div style="page-break-after: always;"></div>\n',
  caret: 45,
}))

export function insertTable(rows = 2, columns = 2): StateCommand {
  const header = `| ${Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const body = Array.from(
    { length: rows },
    () => `| ${Array.from({ length: columns }, () => '   ').join(' | ')} |`,
  )

  const block = insertBlock(() => ({ text: [header, divider, ...body].join('\n'), caret: 2 }), {
    above: true,
    below: true,
  })

  return (target) => {
    const line = target.state.doc.lineAt(target.state.selection.main.head)
    return !/^\s*\|/.test(line.text) && block(target)
  }
}

function wrapped(bang: '' | '!'): StateCommand {
  return ({ state, dispatch }) => {
    const update = state.changeByRange((range) => {
      const label = state.doc.sliceString(range.from, range.to)
      const insert = `${bang}[${label}]()`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length - 1),
      }
    })

    dispatch(state.update(update, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

export const insertLink = wrapped('')
export const insertImage = wrapped('!')

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })

const ORDERED_TASK = /^(?:[ \t]*>[ \t]?)*[ \t]*\d{1,9}[.)][ \t]+\[.\]/u
const FRESH_NUMBER = /^(?:[ \t]*>[ \t]?)*[ \t]*\d{1,9}[.)] $/u

const EMPTY_ORDERED_TASK = /^((?:[ \t]*>[ \t]?)*)[ \t]*\d{1,9}[.)][ \t]+\[.\][ \t]*$/u

function endEmptyTask(state: EditorState): TransactionSpec | null {
  const range = state.selection.main
  if (state.selection.ranges.length > 1 || !range.empty) return null

  const line = state.doc.lineAt(range.head)
  const quote = EMPTY_ORDERED_TASK.exec(line.text)?.[1]
  if (quote === undefined || range.head !== line.to || inCode(state, line.from)) return null

  return {
    changes: { from: line.from, to: line.to, insert: quote },
    selection: { anchor: line.from + quote.length },
    userEvent: 'input',
  }
}

export const continueLists: StateCommand = ({ state, dispatch }) => {
  const ended = endEmptyTask(state)
  if (ended) {
    dispatch(state.update(ended))
    return true
  }

  return continueMarkup({
    state,
    dispatch: (made) => {
      const boxes: number[] = []
      made.newSelection.ranges.forEach((range, at) => {
        const before = state.selection.ranges[at]
        if (!before || !ORDERED_TASK.test(state.doc.lineAt(before.head).text)) return

        const line = made.newDoc.lineAt(range.head)
        if (FRESH_NUMBER.test(made.newDoc.sliceString(line.from, range.head)))
          boxes.push(range.head)
      })
      if (!boxes.length) {
        dispatch(made)
        return
      }

      const boxed = ChangeSet.of(
        boxes.map((at) => ({ from: at, insert: '[ ] ' })),
        made.newDoc.length,
      )
      dispatch(
        state.update({
          changes: made.changes.compose(boxed),
          selection: made.newSelection.map(boxed, 1),
          scrollIntoView: true,
          userEvent: 'input',
        }),
      )
    },
  })
}
