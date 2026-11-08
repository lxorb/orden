import type { EditorView } from '@orden/editor'
import { blocksOf, lines } from '@orden/markdown/links'
import { type Property, readProperties } from '@orden/markdown/properties'
import { taskAt } from '@orden/markdown/tasks'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { type Anchor, headingPath, headingsIn, taskWords } from './anchors'
import { type Desk, type NoteAt, openNote, reachable, wordsOf } from './desk'
import { TYPING } from './edit'
import { DocError } from './problem'
import { revOf } from './rev'

const INCLUDES = [
  'text',
  'outline',
  'properties',
  'tasks',
  'links',
  'backlinks',
  'blocks',
  'selection',
] as const

type Include = (typeof INCLUDES)[number]

const PLAIN: readonly Include[] = ['text', 'outline', 'tasks', 'blocks']

function readIncludes(value: unknown): readonly Include[] {
  if (value === undefined || value === null) return PLAIN
  if (!Array.isArray(value)) throw new DocError('bad_include', value, 'include is a list')

  return value.map((one: unknown) => {
    const found = INCLUDES.find((part) => part === one)
    if (!found) throw new DocError('bad_include', one, `include is some of ${INCLUDES.join(', ')}`)
    return found
  })
}

interface OutlineRow {
  anchor: Anchor
  level: number
  title: string
  line: number
}

interface TaskRow {
  anchor: Anchor
  done: boolean
  line: number
}

interface BlockRow {
  anchor: Anchor
  line: number
  text: string
}

interface Where {
  from: number
  to: number
  selected: string
  caret: { line: number; column: number }
  visible: { from: number; to: number }
}

export interface NoteRead {
  path: string
  space: string
  rev: string
  open: boolean
  typing: boolean
  text?: string
  outline?: OutlineRow[]
  tasks?: TaskRow[]
  blocks?: BlockRow[]
  properties?: Property[]
  meta?: Readonly<Record<string, string>>
  links?: unknown[]
  backlinks?: unknown[]
  selection?: Where | null
}

function numbered<T>(rows: readonly T[], nameOf: (row: T) => string): (number | undefined)[] {
  const seen = new Map<string, number>()
  const total = new Map<string, number>()
  for (const row of rows) total.set(nameOf(row), (total.get(nameOf(row)) ?? 0) + 1)

  return rows.map((row) => {
    const name = nameOf(row)
    const at = (seen.get(name) ?? 0) + 1
    seen.set(name, at)
    return (total.get(name) ?? 0) > 1 ? at : undefined
  })
}

function outlineOf(text: string): OutlineRow[] {
  const headings = headingsIn(text)
  const paths = headings.map(headingPath)
  const nth = numbered(paths, (path) => path)

  return headings.map((heading, index) => {
    const which = nth[index]
    return {
      anchor: { heading: paths[index] ?? heading.title, ...(which ? { nth: which } : {}) },
      level: heading.level,
      title: heading.title,
      line: heading.line,
    }
  })
}

function tasksOf(text: string): TaskRow[] {
  const found: { words: string; done: boolean; line: number }[] = []

  for (const row of lines(text)) {
    if (row.code) continue
    const words = taskWords(row.text)
    const task = taskAt(row.text)
    if (words !== null && task) found.push({ words, done: task.done, line: row.line })
  }

  const nth = numbered(found, (one) => one.words)
  return found.map((one, index) => {
    const which = nth[index]
    return {
      anchor: { task: one.words, ...(which ? { nth: which } : {}) },
      done: one.done,
      line: one.line,
    }
  })
}

function blocksIn(text: string): BlockRow[] {
  return blocksOf(text).flatMap((block) =>
    block.id === null ? [] : [{ anchor: { block: block.id }, line: block.line, text: block.text }],
  )
}

function whereIn(view: EditorView): Where {
  const { state } = view
  const { from, to, head } = state.selection.main
  const caret = state.doc.lineAt(head)
  const shown = view.visibleRanges
  const first = shown[0]?.from ?? 0
  const last = shown.at(-1)?.to ?? state.doc.length

  return {
    from,
    to,
    selected: state.sliceDoc(from, to),
    caret: { line: caret.number - 1, column: head - caret.from },
    visible: {
      from: state.doc.lineAt(first).number - 1,
      to: state.doc.lineAt(last).number - 1,
    },
  }
}

function typingIn(open: NoteDoc | null): boolean {
  const last = open?.live.readerAt ?? null
  return last !== null && Date.now() - last < TYPING
}

export async function readNote(desk: Desk, at: NoteAt, include?: unknown): Promise<NoteRead> {
  const asked = new Set(readIncludes(include))
  const note = reachable(desk, at)
  const text = await wordsOf(desk, note)
  const open = openNote(desk, note)
  const view = open ? desk.frontView(open) : null

  return {
    path: note.relative,
    space: note.space.name,
    rev: revOf(text),
    open: open !== null,
    typing: typingIn(open),
    ...(asked.has('text') ? { text } : {}),
    ...(asked.has('outline') ? { outline: outlineOf(text) } : {}),
    ...(asked.has('tasks') ? { tasks: tasksOf(text) } : {}),
    ...(asked.has('blocks') ? { blocks: blocksIn(text) } : {}),
    ...(asked.has('properties')
      ? { properties: readProperties(text) ?? [], meta: desk.metaOf?.(note.path) ?? {} }
      : {}),
    ...(asked.has('links') ? { links: desk.linksOf(note.path) } : {}),
    ...(asked.has('backlinks') ? { backlinks: desk.backlinksOf(note.path) } : {}),
    ...(asked.has('selection') ? { selection: view ? whereIn(view) : null } : {}),
  }
}
