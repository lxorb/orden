import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { blocksOf, foldName } from '@orden/markdown/links'
import { blockNamer } from './block-namer'
import {
  fuzzy,
  type LinkWrite,
  linkWriter,
  type NoteIndex,
  noteIndex,
  type NoteRef,
  resolveNote,
  resolveRelative,
  shortestReaching,
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

function typing(context: CompletionContext) {
  return context.matchBefore(/\[\[[^[\]\n]*/)
}

const REST_OF_LINK = /^([^[\]\n]*)\]\]/

function insert(target: LinkWrite) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const start = opened(view, from)
    const line = view.state.doc.lineAt(to)
    const rest = REST_OF_LINK.exec(view.state.doc.sliceString(to, line.to))?.[1] ?? null
    const kept = rest === null ? '' : keptOf(rest, !!target.fragment)
    const fragment = target.fragment ?? (kept.startsWith('#') ? headingOf(kept) : null)
    const written = view.state.facet(linkWriter)({ ...target, fragment })
    const wiki = written.startsWith('[[') && written.endsWith(']]')
    const text = wiki && kept ? `${written.slice(0, -2)}${tailOf(kept, fragment)}]]` : written

    view.dispatch({
      changes: { from: start, to: rest === null ? to : to + rest.length + 2, insert: text },
      selection: { anchor: start + text.length },
      userEvent: 'input.complete',
    })
  }
}

function keptOf(rest: string, fragmentChosen: boolean): string {
  const marks = fragmentChosen ? ['|'] : ['#', '|']
  const at = marks
    .map((mark) => rest.indexOf(mark))
    .filter((one) => one !== -1)
    .reduce((first, one) => Math.min(first, one), rest.length)
  return rest.slice(at)
}

function headingOf(kept: string): string | null {
  const bar = kept.indexOf('|')
  const heading = (bar === -1 ? kept : kept.slice(0, bar)).slice(1)
  return heading || null
}

function tailOf(kept: string, fragment: string | null): string {
  if (!kept.startsWith('#') || fragment === null) return kept
  const bar = kept.indexOf('|')
  return bar === -1 ? '' : kept.slice(bar)
}

export function about(index: NoteIndex, note: NoteRef): LinkWrite {
  const markdown = shortestReaching(
    note.path,
    (written) => resolveRelative(index, written)?.path === note.path,
  )
  return { name: nameFor(index, note), markdown, path: note.path, from: index.path }
}

function nameFor(index: NoteIndex, note: NoteRef): string {
  const same = index.notes.filter((one) => foldName(one.name) === foldName(note.name))
  if (same.length <= 1) return note.name.normalize('NFC')

  const parts = note.path.replace(MARKDOWN, '').split('/')
  for (let from = parts.length - 1; from >= 0; from--) {
    const written = parts.slice(from).join('/')
    if (resolveNote(index, written)?.path === note.path) return written.normalize('NFC')
  }
  return `/${parts.join('/')}`.normalize('NFC')
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
    rows.push({
      label: note.name.normalize('NFC'),
      ...(detail === undefined ? {} : { detail }),
      apply: insert(about(index, note)),
      type: 'text',
    })
  }

  for (const alias of note.aliases) {
    if (!alias.trim()) continue
    if (archived ? foldName(alias) !== needle : needle && !foldName(alias).includes(needle)) {
      continue
    }

    rows.push({
      label: alias,
      detail: note.name,
      apply: insert({ ...about(index, note), name: alias }),
      type: 'text',
    })
  }

  return rows
}

function noteOptions(index: NoteIndex, typed: string): Completion[] {
  const needle = foldName(typed.trim())
  const rows: Completion[] = []

  for (const note of index.notes) {
    rows.push(...rowsFor(index, note, needle))
    if (rows.length >= MOST_SHOWN) break
  }

  return rows.slice(0, MOST_SHOWN)
}

function matches(note: NoteRef, needle: string): boolean {
  return (
    foldName(note.name).includes(needle) ||
    foldName(note.path).includes(needle) ||
    note.aliases.some((alias) => foldName(alias).includes(needle))
  )
}

function headingOptions(target: LinkWrite, note: NoteRef, typed: string): Completion[] {
  const needle = foldName(typed.trim())

  return note.headings
    .filter((heading) => !needle || foldName(heading).includes(needle))
    .slice(0, MOST_SHOWN)
    .map((heading) => ({
      label: heading,
      apply: insert({ ...target, fragment: heading }),
      type: 'keyword',
    }))
}

async function blockOptions(
  index: NoteIndex,
  target: LinkWrite,
  note: NoteRef,
  typed: string,
): Promise<Completion[]> {
  const source = await index.read(note.path)
  if (source === null) return []

  const needle = foldName(typed.trim())

  return blocksOf(source)
    .filter((block) => block.text !== '')
    .filter((block) => !needle || foldName(block.text).includes(needle))
    .slice(0, MOST_SHOWN)
    .map((block) => ({
      label: block.text,
      apply:
        block.id === null
          ? name(note.path, block.line, target)
          : insert({ ...target, fragment: `^${block.id}` }),
      type: 'property',
    }))
}

function name(path: string, line: number, target: LinkWrite) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const start = opened(view, from)
    const typed = view.state.doc.sliceString(start, to)
    const head = view.state.selection.main.head
    void view.state
      .facet(blockNamer)(path, line)
      .then((id) => {
        if (!id) return
        const moved = view.state.selection.main.head - head
        const now = view.state.doc.sliceString(start + moved, to + moved)
        if (now !== typed) return
        insert({ ...target, fragment: `^${id}` })(view, completion, from + moved, to + moved)
      })
      .catch(() => undefined)
  }
}

function spaceHeadings(index: NoteIndex, typed: string): Completion[] {
  const needle = foldName(typed.trim())
  const rows: Completion[] = []

  for (const note of index.notes) {
    if (note.archived) continue

    for (const heading of note.headings) {
      if (!fuzzy(heading, needle)) continue

      rows.push({
        label: heading,
        detail: note.name,
        apply: insert({ ...about(index, note), fragment: heading }),
        type: 'keyword',
      })
      if (rows.length >= MOST_SHOWN) return rows
    }
  }

  return rows
}

function namedBlocks(index: NoteIndex, needle: string): Completion[] {
  const rows: Completion[] = []

  for (const note of index.notes) {
    if (note.archived) continue

    for (const id of note.blocks) {
      if (!fuzzy(id, needle)) continue

      rows.push({
        label: `^${id}`,
        detail: note.name,
        apply: insert({ ...about(index, note), fragment: `^${id}` }),
        type: 'property',
        boost: 1,
      })
      if (rows.length >= MOST_SHOWN) return rows
    }
  }

  return rows
}

function foundBlock(index: NoteIndex, block: SpaceBlock): Completion {
  const note = index.notes.find((one) => one.path === block.path)
  const target: LinkWrite = note
    ? about(index, note)
    : { name: block.path.replace(MARKDOWN, ''), path: block.path, from: index.path }

  return {
    label: block.text,
    ...(note ? { detail: note.name } : {}),
    apply: block.id
      ? insert({ ...target, fragment: `^${block.id}` })
      : name(block.path, block.line, target),
    type: 'property',
  }
}

async function spaceBlocks(index: NoteIndex, typed: string): Promise<Completion[]> {
  const needle = foldName(typed.trim())
  const rows = namedBlocks(index, needle)
  const named = new Set(rows.map((row) => row.label))

  if (!index.searchBlocks || needle.length < LEAST_SEARCHED) return rows

  const found = await index.searchBlocks(needle, MOST_SHOWN).catch(() => [])

  for (const block of found) {
    if (!block.text.trim()) continue
    if (block.path === index.path) continue
    if (block.id && named.has(`^${block.id}`)) continue

    rows.push(foundBlock(index, block))
    if (rows.length >= MOST_SHOWN) break
  }

  return rows
}

export function wikilinkCompletions(
  context: CompletionContext,
): CompletionResult | Promise<CompletionResult | null> | null {
  const typed = typing(context)
  if (!typed) return null

  const index = context.state.facet(noteIndex)
  const inner = typed.text.slice(2)
  const hash = inner.indexOf('#')

  const across = typed.from + 2 + MARKER

  if (inner.startsWith('##')) {
    const options = spaceHeadings(index, inner.slice(MARKER))
    return options.length ? { from: across, options, validFor: /^[^[\]\n#|^]*$/ } : null
  }

  if (inner.startsWith('^^')) {
    return spaceBlocks(index, inner.slice(MARKER)).then((options) =>
      options.length ? { from: across, options, validFor: /^[^[\]\n#|^]*$/ } : null,
    )
  }

  if (hash === -1) {
    const options = noteOptions(index, inner)
    return options.length ? { from: typed.from + 2, options, validFor: /^[^[\]\n#|]*$/ } : null
  }

  const named = inner.slice(0, hash).trim()
  const note = named
    ? resolveNote(index, named)
    : (index.notes.find((one) => one.path === index.path) ?? null)
  if (!note) return null

  const after = inner.slice(hash + 1)
  const from = typed.from + 2 + hash + 1
  const target: LinkWrite = { name: named, path: note.path, from: index.path }

  if (!after.startsWith('^')) {
    const options = headingOptions(target, note, after)
    return options.length ? { from, options, validFor: /^[^[\]\n|^]*$/ } : null
  }

  return blockOptions(index, target, note, after.slice(1)).then((options) =>
    options.length ? { from, options, validFor: /^\^[^[\]\n|]*$/ } : null,
  )
}
