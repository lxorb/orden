import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { MapMode, StateEffect, StateField } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { headingWords } from '@orden/markdown/escapes'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { blocksOf, commentedLines, foldName, headingText, isHeading, type Row, rowsOf } from '@orden/markdown/links'
import { inCode } from '../code'
import { bestShown } from './best-shown'
import { blockNamer } from './block-namer'
import {
  fuzzy,
  type LinkWrite,
  linkWriter,
  type NoteIndex,
  nameFor,
  noteIndex,
  type NoteRef,
  resolveNote,
  resolveRelative,
  shortestReaching,
  shownNote,
  type SpaceBlock,
} from './notes'

function opened(view: EditorView, from: number): number {
  const line = view.state.doc.lineAt(from)
  const at = view.state.doc.sliceString(line.from, from).lastIndexOf('[[')
  return at === -1 ? from : line.from + at
}
const MOST_SHOWN = 40
const LEAST_SEARCHED = 2
const MARKER = 2
const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const typing = (context: CompletionContext) => context.matchBefore(/\[\[[^[\]\n]*/)
const REST_OF_LINK = /^([^[\]\n]*)\]\]/
const insert = (target: LinkWrite) => (view: EditorView, _completion: Completion, from: number, to: number) => {
  const start = opened(view, from)
  const line = view.state.doc.lineAt(to)
  const rest = REST_OF_LINK.exec(view.state.doc.sliceString(to, line.to))?.[1] ?? null
  const kept = rest === null ? '' : keptOf(rest, !!target.fragment)
  const fragment = target.fragment ?? (kept.startsWith('#') ? headingOf(kept) : null)
  const shown = target.shown ?? shownOf(kept)
  const linked = view.state.facet(linkWriter)({
    ...target,
    fragment,
    ...(shown ? { shown } : {}),
  })
  const wiki = linked.startsWith('[[') && linked.endsWith(']]')
  const bar = linked.lastIndexOf('|')
  const inTable = wiki && bar !== -1 && kept.includes('\\|')
  const written = inTable ? `${linked.slice(0, bar)}\\${linked.slice(bar)}` : linked
  const end = rest === null ? to : to + rest.length + 2
  const text = !wiki && plainInMatter(view, start, end) ? JSON.stringify(linked) : written
  view.dispatch({
    changes: { from: start, to: end, insert: text },
    selection: { anchor: start + text.length },
    userEvent: 'input.complete',
  })
}
const OPENS_VALUE = /^[ \t]*(?:-[ \t]+|[^\s#:-][^:]*:[ \t]+)$/
function plainInMatter(view: EditorView, from: number, to: number): boolean {
  const doc = view.state.doc
  if (doc.sliceString(0, 3) !== '---') return false
  const block = frontMatterBlock(doc.toString())
  if (!block || from < block.body.from || to > block.body.to) return false
  const line = doc.lineAt(from)
  return OPENS_VALUE.test(doc.sliceString(line.from, from)) && !doc.sliceString(to, line.to).trim()
}
function keptOf(rest: string, fragmentChosen: boolean): string {
  const marks = fragmentChosen ? ['|'] : ['#', '|']
  const at = marks
    .map((mark) => rest.indexOf(mark))
    .filter((one) => one !== -1)
    .reduce((first, one) => Math.min(first, one), rest.length)
  return rest.slice(rest[at] === '|' && rest[at - 1] === '\\' ? at - 1 : at)
}
const ESCAPED_BAR = /\\(?=\|)/g
function headingOf(written: string): string | null {
  const kept = written.replace(ESCAPED_BAR, '')
  const bar = kept.indexOf('|')
  const heading = (bar === -1 ? kept : kept.slice(0, bar)).slice(1)
  return heading || null
}
function shownOf(written: string): string | null {
  const kept = written.replace(ESCAPED_BAR, '')
  const bar = kept.indexOf('|')
  return bar === -1 ? null : kept.slice(bar + 1) || null
}
export function offeredBlocks(source: string) {
  const commented = commentedLines(source)
  return blocksOf(source).filter((block) => block.text !== '' && !commented.has(block.line))
}
export function about(index: NoteIndex, note: NoteRef): LinkWrite {
  const markdown = shortestReaching(note.path, (written) => resolveRelative(index, written)?.path === note.path)
  return { name: nameFor(index, note), markdown, path: note.path, from: index.path }
}
function folderOf(path: string): string | undefined {
  const at = path.lastIndexOf('/')
  return at === -1 ? undefined : path.slice(0, at)
}
function rowsFor(index: NoteIndex, note: NoteRef, needle: string): Completion[] {
  const rows: Completion[] = []
  const folder = folderOf(note.path)
  const archived = note.archived === true
  const detail = archived ? 'Archived' : folder
  if (archived ? foldName(note.name) === needle : !needle || matches(note, needle)) {
    const label = note.name.normalize('NFC')
    const shown = shownNote(note)
    rows.push({
      label,
      ...(shown === label ? {} : { displayLabel: shown }),
      ...(detail === undefined ? {} : { detail }),
      apply: insert(about(index, note)),
      type: 'text',
    })
  }
  for (const alias of note.aliases) {
    if (!alias.trim()) continue
    if (archived ? foldName(alias) !== needle : needle && !foldName(alias).includes(needle)) continue
    rows.push({
      label: alias,
      detail: shownNote(note),
      apply: insert(
        resolveNote(index, alias)?.path === note.path
          ? { ...about(index, note), name: alias, file: nameFor(index, note) }
          : { ...about(index, note), shown: alias },
      ),
      type: 'text',
    })
  }
  return rows
}
function noteOptions(index: NoteIndex, typed: string): { rows: Completion[]; all: boolean } {
  const needle = foldName(typed.trim())
  const rows: Completion[] = []
  for (const note of index.notes) {
    rows.push(...rowsFor(index, note, needle))
    if (!needle && rows.length > MOST_SHOWN) break
  }
  return bestShown(rows, needle, MOST_SHOWN)
}
const matches = (note: NoteRef, needle: string): boolean =>
  foldName(note.name).includes(needle) ||
  foldName(note.path).includes(needle) ||
  note.aliases.some((alias) => foldName(alias).includes(needle))
function headingLabel(heading: string): { label: string; displayLabel?: string } {
  const words = headingWords(heading)
  return words === heading ? { label: heading } : { label: heading, displayLabel: words }
}
function headingOptions(target: LinkWrite, note: NoteRef, typed: string): Completion[] {
  const needle = foldName(typed.trim())
  return note.headings
    .filter((heading) => !needle || foldName(heading).includes(needle))
    .slice(0, MOST_SHOWN)
    .map((heading) => ({
      ...headingLabel(heading),
      apply: insert({ ...target, fragment: heading }),
      type: 'keyword',
    }))
}
async function blockOptions(index: NoteIndex, target: LinkWrite, note: NoteRef, typed: string): Promise<Completion[]> {
  const source = await index.read(note.path)
  if (source === null) return []
  const needle = foldName(typed.trim())
  const rows = rowsOf(source)
  return offeredBlocks(source)
    .filter((block) => !needle || foldName(block.text).includes(needle))
    .slice(0, MOST_SHOWN)
    .map((block) => ({
      label: block.text,
      apply: linked(note.path, block.line, headingRow(rows[block.line]), block.id, target),
      type: 'property',
    }))
}
const headingRow = (row: Pick<Row, 'text' | 'code' | 'matter'> | undefined): string | null =>
  row && !row.code && !row.matter && isHeading(row.text) ? headingText(row.text) : null
function linked(path: string, line: number, heading: string | null, id: string | null, target: LinkWrite) {
  if (id) return insert({ ...target, fragment: `^${id}` })
  if (heading !== null) return insert({ ...target, fragment: heading })
  return name(path, line, target)
}
interface Held {
  key: object
  from: number
  to: number
}
const holdTyped = StateEffect.define<Held>()
const dropTyped = StateEffect.define<object>()
const heldTyped = StateField.define<readonly Held[]>({
  create: () => [],
  update(held, transaction) {
    let kept: readonly Held[] = held
    if (transaction.docChanged) {
      kept = held.flatMap((one) => {
        const from = transaction.changes.mapPos(one.from, 1, MapMode.TrackDel)
        const to = transaction.changes.mapPos(one.to, -1, MapMode.TrackDel)
        return from === null || to === null ? [] : [{ ...one, from, to }]
      })
    }
    for (const effect of transaction.effects) {
      if (effect.is(holdTyped)) kept = [...kept, effect.value]
      else if (effect.is(dropTyped)) kept = kept.filter((one) => one.key !== effect.value)
    }
    return kept
  },
})
function held(view: EditorView, from: number, to: number): object {
  if (view.state.field(heldTyped, false) === undefined)
    view.dispatch({ effects: StateEffect.appendConfig.of(heldTyped) })
  const key = {}
  view.dispatch({ effects: holdTyped.of({ key, from, to }) })
  return key
}
function released(view: EditorView, key: object): Held | null {
  const found = view.state.field(heldTyped, false)?.find((one) => one.key === key) ?? null
  view.dispatch({ effects: dropTyped.of(key) })
  return found
}
const name =
  (path: string, line: number, target: LinkWrite) =>
  (view: EditorView, completion: Completion, from: number, to: number) => {
    const start = opened(view, from)
    const typed = view.state.doc.sliceString(start, to)
    const key = held(view, start, to)
    void view.state
      .facet(blockNamer)(path, line)
      .then((id) => {
        const now = released(view, key)
        if (!id || !now || view.state.doc.sliceString(now.from, now.to) !== typed) return
        const shift = now.from - start
        insert({ ...target, fragment: `^${id}` })(view, completion, from + shift, to + shift)
      })
      .catch(() => undefined)
  }
function spaceHeadings(index: NoteIndex, typed: string): { rows: Completion[]; all: boolean } {
  const needle = foldName(typed.trim())
  const rows: Completion[] = []
  for (const note of index.notes) {
    if (note.archived) continue
    for (const heading of note.headings) {
      if (!fuzzy(heading, needle)) continue
      rows.push({
        ...headingLabel(heading),
        detail: shownNote(note),
        apply: insert({ ...about(index, note), fragment: heading }),
        type: 'keyword',
      })
      if (!needle && rows.length > MOST_SHOWN) return bestShown(rows, needle, MOST_SHOWN)
    }
  }
  return bestShown(rows, needle, MOST_SHOWN)
}
function namedBlocks(index: NoteIndex, needle: string): Completion[] {
  const rows: Completion[] = []
  for (const note of index.notes) {
    if (note.archived) continue
    for (const id of note.blocks) {
      if (!fuzzy(id, needle)) continue
      rows.push({
        label: `^${id}`,
        detail: shownNote(note),
        apply: insert({ ...about(index, note), fragment: `^${id}` }),
        type: 'property',
        boost: 1,
      })
      if (!needle && rows.length > MOST_SHOWN) return rows
    }
  }
  return rows
}
async function foundHeading(index: NoteIndex, block: SpaceBlock): Promise<string | null> {
  if (!isHeading(block.text)) return null
  const source = await index.read(block.path).catch(() => null)
  return source === null
    ? headingText(block.text)
    : headingRow(rowsOf(source)[block.line] ?? { text: block.text, code: false, matter: false })
}
function foundBlock(index: NoteIndex, block: SpaceBlock, heading: string | null): Completion {
  const note = index.notes.find((one) => one.path === block.path)
  const target: LinkWrite = note
    ? about(index, note)
    : { name: block.path.replace(MARKDOWN, ''), path: block.path, from: index.path }
  return {
    label: block.text,
    ...(note ? { detail: shownNote(note) } : {}),
    apply: linked(block.path, block.line, heading, block.id, target),
    type: 'property',
  }
}
async function spaceBlocks(index: NoteIndex, typed: string): Promise<{ rows: Completion[]; all: boolean }> {
  const needle = foldName(typed.trim())
  const ids = bestShown(namedBlocks(index, needle), needle, MOST_SHOWN)
  const rows = ids.rows
  const named = new Set(rows.map((row) => row.label))
  if (!index.searchBlocks || needle.length < LEAST_SEARCHED) return ids
  const found = await index.searchBlocks(needle, MOST_SHOWN).catch(() => [])
  for (const block of found) {
    if (!block.text.trim()) continue
    if (block.path === index.path) continue
    if (block.id && named.has(`^${block.id}`)) continue
    rows.push(foundBlock(index, block, await foundHeading(index, block)))
    if (rows.length >= MOST_SHOWN) break
  }
  return { rows, all: false }
}
export function wikilinkCompletions(
  context: CompletionContext,
): CompletionResult | Promise<CompletionResult | null> | null {
  const typed = typing(context)
  if (!typed || inCode(context.state, typed.from)) return null
  const index = context.state.facet(noteIndex)
  const inner = typed.text.slice(2)
  const hash = inner.indexOf('#')
  const across = typed.from + 2 + MARKER
  if (inner.startsWith('##')) {
    const { rows: options, all } = spaceHeadings(index, inner.slice(MARKER))
    if (!options.length) return null
    return { from: across, options, ...(all ? { validFor: /^[^[\]\n#|^]*$/ } : {}) }
  }
  if (inner.startsWith('^^')) {
    return spaceBlocks(index, inner.slice(MARKER)).then(({ rows: options, all }) =>
      options.length ? { from: across, options, ...(all ? { validFor: /^[^[\]\n#|^]*$/ } : {}) } : null,
    )
  }
  if (hash === -1) {
    const { rows: options, all } = noteOptions(index, inner)
    if (!options.length) return null
    if (inner.includes('/')) return { from: typed.from + 2, options, filter: false }
    return { from: typed.from + 2, options, ...(all ? { validFor: /^[^[\]\n#|]*$/ } : {}) }
  }
  const named = inner.slice(0, hash).trim()
  const note = named ? resolveNote(index, named) : (index.notes.find((one) => one.path === index.path) ?? null)
  if (!note) return null
  const after = inner.slice(hash + 1)
  const from = typed.from + 2 + hash + 1
  const target: LinkWrite = {
    name: named,
    path: note.path,
    from: index.path,
    file: nameFor(index, note),
  }
  if (!after.startsWith('^')) {
    const options = headingOptions(target, note, after)
    return options.length ? { from, options, validFor: /^[^[\]\n|^]*$/ } : null
  }
  return blockOptions(index, target, note, after.slice(1)).then((options) =>
    options.length ? { from: from + 1, options, validFor: /^[^[\]\n|^]*$/ } : null,
  )
}
