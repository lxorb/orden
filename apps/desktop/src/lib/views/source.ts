/** Where a view's base comes from and where a change to it goes, for each of the four
 *  places a view stands:
 *
 *  - a built-in view in a tab (Today, a project): the base Orden ships, or the one the
 *    tab changed it into, kept in the tab's words (spec.ts);
 *  - a `.base` file in a tab, or embedded with `![[Bugs.base#Board]]`: the file, read
 *    and written back with every key Orden does not know kept (`writeBase`), through
 *    the same write a note takes, so a change is one undo;
 *  - a ` ```base ` fence: the fence's own words in the note it stands in.
 *
 *  Each answers a `Source` (live.svelte.ts), so the view on screen never knows which. */

import { type Base, builtinView, readBase, type Row, todayAs, writeBase } from '@orden/bases'
import { CodeBlocks, OPENS } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { links } from '../link-index.svelte'
import { modes } from '../modes.svelte'
import { rows } from '../rows/rows.svelte'
import { insideSpace, samePath, within } from '../space-paths'
import { workspace } from '../workspace.svelte'
import type { Tab } from '../workspace/documents.svelte'
import { noteText, writeNoteText } from '../workspace/note-text'
import {
  EVERY_SPACE,
  keepProjectView,
  keepTodosView,
  projectView,
  renamedTo,
  todosView,
} from './kept-views'
import type { Shown, Source } from './live.svelte'
import { followSpaceTabs, unscoped } from './space-follow'
import { asShipped, readSpec, type ViewSpec, writeSpec } from './spec'

/** Today as Settings has it: with the tasks that have no start date in it, or not (#408). */
function today(): Base {
  return builtinView('today', { undated: modes.undatedInToday })
}

/** A built-in view as Orden ships it, whatever a tab or a space made of it: what Reset
 *  puts back and what the Display menu calls the default. */
export function shippedBase(spec: ViewSpec): Base {
  if (spec.builtin === 'todos')
    return builtinView('todos', spec.space === undefined ? {} : { space: spec.space })
  return builtinBase(asShipped(spec))
}

/** The base a built-in spec asks for: as the tab changed it, else as Orden ships it. */
export function builtinBase(spec: ViewSpec): Base {
  if (spec.yaml !== undefined) {
    const base = readBase(spec.yaml)
    // A Today the tab changed still follows the switch; see `todayAs`.
    return spec.builtin === 'today' ? todayAs(base, modes.undatedInToday) : base
  }
  switch (spec.builtin) {
    case 'todos': {
      // As it was left in this space, else as Orden ships it (#1046).
      const kept = spec.space === undefined ? everyTodosView() : todosView(spec.space)
      return kept === undefined ? shippedBase(spec) : readBase(kept)
    }
    case 'project':
      return builtinView('project', {
        note: { space: spec.space ?? '', path: spec.path ?? '' },
      })
    case 'label':
      return builtinView('label', {
        tag: spec.tag ?? '',
        ...(spec.space === undefined ? {} : { space: spec.space }),
      })
    case 'inbox':
      return builtinView('inbox', { inboxes: rows.inboxes() })
    case 'upcoming':
    case 'logbook':
      return builtinView(spec.builtin)
    case 'today':
    case undefined:
      return today()
  }
  return today()
}

/** The space a path on this disk is in, by name. */
function spaceOf(path: string): { name: string; root: string } | null {
  return workspace.spaces.find((one) => within(one.root, path, one.root) !== null) ?? null
}

/** The note row at a path on this disk, for `this`. */
export function rowAt(path: string | null): Row | undefined {
  if (path === null) return undefined
  return rows.at(path).find((one) => one.kind === 'note')
}

/** What a file says now: the open document's words where it is open, else the disk. */
async function fileText(path: string): Promise<string> {
  const text = await noteText(workspace, path)
  if (text === null) throw new Error('no such base')
  return text
}

/** A base file heard being written by anyone, the view's own writes included. */
function watchFile(path: string) {
  return (changed: () => void) =>
    links.hearSaves((saved) => {
      if (samePath(saved, path)) changed()
    })
}

/** A base file, read and written back. */
export function fileSource(path: string, view?: string, self?: () => Row | undefined): Source {
  let before = ''
  return {
    scope: spaceOf(path)?.name ?? null,
    path,
    view,
    ...(self ? { self } : {}),
    async load() {
      before = await fileText(path)
      return readBase(before)
    },
    async save(next) {
      const now = await fileText(path).catch(() => before)
      const after = writeBase(next, now)
      if (after === now) return
      await writeNoteText(workspace, path, now, after)
      before = after
    },
    watch: watchFile(path),
  }
}

/** A built-in view's change kept on this device where it has a place there: a project
 *  laid out again as it was left the next time it is opened here, and a space's Todos in
 *  that space, wherever it was changed (a tab, the Tasks panel). */
function keepChange(spec: ViewSpec, yaml: string): void {
  if (spec.builtin === 'project') keepProjectView(spec.space ?? '', spec.path ?? '', yaml)
  if (spec.builtin === 'todos') {
    const shipped = writeBase(shippedBase(spec))
    keepTodosView(spec.space ?? EVERY_SPACE, yaml === shipped ? undefined : yaml)
  }
}

function everyTodosView(): string | undefined {
  const kept = todosView(EVERY_SPACE)
  if (kept !== undefined) return kept
  const space = workspace.activeSpace?.name
  const was = space === undefined ? undefined : todosView(space)
  if (space === undefined || was === undefined) return undefined
  const now = unscoped(was, space)
  keepTodosView(EVERY_SPACE, now)
  return now
}

function everySpace(tab: Tab): void {
  const spec = readSpec(tab.doc)
  if (spec?.builtin !== 'todos' || spec.space === undefined) return
  tab.note.replace(writeSpec({ builtin: 'todos' }), false)
  workspace.scheduleSession()
}

function followLost(tab: Tab): void {
  const name = readSpec(tab.doc)?.space
  const spaces = workspace.spaces
  if (name === undefined || !spaces.length || spaces.some((one) => one.name === name)) return
  const now = renamedTo(name)
  if (now === undefined || !spaces.some((one) => one.name === now))
    throw new Error(`no space ${name}`)
  followSpaceTabs(name, now, workspace.tabs)
  workspace.scheduleSession()
}

/** A built-in view in a tab: what it changes is kept in the tab's words, and is the
 *  tab's own until "Copy to a base" writes it to a file. */
export function tabSource(tab: Tab): Source {
  const spec = () => readSpec(tab.doc) ?? {}
  return {
    scope: null,
    load: () => {
      try {
        everySpace(tab)
        followLost(tab)
        return Promise.resolve(builtinBase(spec()))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
    save(next) {
      const now = spec()
      const yaml = writeBase(next)
      tab.note.replace(writeSpec({ ...now, yaml }), false)
      keepChange(now, yaml)
      workspace.scheduleSession()
      return Promise.resolve()
    },
  }
}

/** A built-in view chosen in the Tasks panel (#374), drawn there and in no tab: it
 *  starts as it was left on this device and keeps what it changes the same way. */
export function panelSource(spec: ViewSpec): Source {
  const kept =
    spec.builtin === 'project' ? projectView(spec.space ?? '', spec.path ?? '') : undefined
  let now: ViewSpec = kept === undefined ? spec : { ...spec, yaml: kept }
  return {
    scope: null,
    load: () => Promise.resolve(builtinBase(now)),
    save(next) {
      const yaml = writeBase(next)
      now = { ...asShipped(now), yaml }
      keepChange(now, yaml)
      return Promise.resolve()
    },
  }
}

interface DrawnFence {
  words: string
  from: number
  to: number
  margin: boolean
}

function drawnFences(text: string): DrawnFence[] {
  const out: DrawnFence[] = []
  const code = new CodeBlocks()
  const matter = frontMatterBlock(text)
  let at = matter ? matter.to : 0
  let open: { from: number; prefix: number; lines: string[] } | null = null

  const close = (to: number) => {
    if (open) {
      out.push({
        words: open.lines.join('\n'),
        from: open.from,
        to,
        margin: open.prefix === 0,
      })
    }
    open = null
  }

  while (at < text.length) {
    const end = text.indexOf('\n', at)
    const next = end === -1 ? text.length : end + 1
    const raw = text.slice(at, end === -1 ? text.length : end)
    const kind = code.line(raw)

    if (open && code.fence === null) close(at)
    else if (open) {
      const { prefix } = open
      open.lines.push(prefix ? raw.replace(new RegExp(`^[ \\t>]{0,${prefix}}`), '') : raw)
    }

    if (kind === OPENS && code.fence !== null) {
      const prefix = raw.indexOf(code.fence)
      const info = raw.slice(prefix + code.fence.length).trim()
      if (info.split(/\s+/)[0] === 'base') open = { from: next, prefix, lines: [] }
    }
    at = next
  }
  close(text.length)
  return out
}

const fenceWords = (words: string) => words.replace(/\r/g, '').trimEnd()

export function fenceAt(text: string, code: string): { from: number; to: number } | null {
  const wanted = fenceWords(code)
  const same = drawnFences(text).filter((one) => fenceWords(one.words) === wanted)
  const [only] = same
  return only?.margin && same.length === 1 ? { from: only.from, to: only.to } : null
}

/** Where the reader was in each fence, by its note and its words. The editor draws a
 *  fence again whenever its words change, and every change to the view is a change
 *  to its words, so without this a new view, a duplicate or a filter set on the
 *  second tab would land back on the first with the search gone. Kept for the
 *  session, so a note opened again shows its fence as it was left. */
const fenceViews = new Map<string, Shown>()

/** Enough places for every fence a session reads and the versions undo walks back
 *  through; the oldest goes first. */
const KEPT_PLACES = 200

function remember(key: string, place: Shown) {
  fenceViews.delete(key)
  fenceViews.set(key, place)
  for (const old of fenceViews.keys()) {
    if (fenceViews.size <= KEPT_PLACES) break
    fenceViews.delete(old)
  }
}

/** A fence's place in `fenceViews`: its words as the editor and the write both have
 *  them, whatever the last line ends with. */
const fenceKey = (path: string, words: string) => `${path}\n${words.replace(/\s+$/, '')}`

/** A ` ```base ` fence in a note at `path` (on this disk; null for a note with no
 *  file, `stranger` where that is a file somebody shared on its own). Its changes are
 *  written into the fence, so the note is the base. */
export function fenceSource(code: string, path: string | null, stranger = false): Source {
  let words = code
  let shown = path === null ? undefined : fenceViews.get(fenceKey(path, code))
  const space = path === null ? workspace.activeSpace : spaceOf(path)
  let fixed = true
  return {
    scope: space?.name ?? null,
    path,
    stranger,
    fixed: () => fixed,
    self: () => rowAt(path),
    shown: () => shown,
    keep(now) {
      shown = now
      if (path !== null) remember(fenceKey(path, words), now)
    },
    async load() {
      const text = path === null ? null : await noteText(workspace, path).catch(() => null)
      fixed = text === null || fenceAt(text, words) === null
      return readBase(words)
    },
    async save(next, now) {
      if (path === null) return
      const text = await noteText(workspace, path)
      if (text === null) return
      const at = fenceAt(text, words)
      if (!at) return
      const written = writeBase(next, words)
      // Before the write, which is what draws the fence again.
      shown = now ?? shown
      if (shown) remember(fenceKey(path, written), shown)
      const after =
        text.slice(0, at.from) +
        (written.endsWith('\n') ? written : `${written}\n`) +
        text.slice(at.to)
      await writeNoteText(workspace, path, text, after)
      words = written
    },
  }
}

/** Where a base file an embed names is on this disk, resolved the way a link to a file
 *  is (the link index's `targetOf`); null where the space has no such file. */
export function embeddedPath(target: string, from: string | null): string | null {
  const root = workspace.activeSpace?.root
  if (root === undefined) return null
  const plain = target.split('#')[0] ?? target
  const found = links.targetOf(from, { kind: 'wikilink', target: plain })
  return found === null ? null : insideSpace(root, found)
}
