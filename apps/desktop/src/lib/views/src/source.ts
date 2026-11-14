import { readBase, type Row, writeBase } from '@orden/bases'
import { CodeBlocks, OPENS } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { links } from '../../link-index.svelte'
import { rows } from '../../rows/rows.svelte'
import { insideSpace, samePath, within } from '../../platform/src/api'
import { workspace } from '../../workspace.svelte'
import { noteText, writeNoteText } from '../../workspace/note-text'
import type { Shown, Source } from './live.svelte'

function spaceOf(path: string): { name: string; root: string } | null {
  return workspace.spaces.find((one) => within(one.root, path, one.root) !== null) ?? null
}

export function rowAt(path: string | null): Row | undefined {
  if (path === null) return undefined
  return rows.at(path).find((one) => one.kind === 'note')
}

async function fileText(path: string): Promise<string> {
  const text = await noteText(workspace, path)
  if (text === null) throw new Error('no such base')
  return text
}

function watchFile(path: string) {
  return (changed: () => void) =>
    links.hearSaves((saved) => {
      if (samePath(saved, path)) changed()
    })
}

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

const fenceViews = new Map<string, Shown>()

const KEPT_PLACES = 200

function remember(key: string, place: Shown) {
  fenceViews.delete(key)
  fenceViews.set(key, place)
  for (const old of fenceViews.keys()) {
    if (fenceViews.size <= KEPT_PLACES) break
    fenceViews.delete(old)
  }
}

const fenceKey = (path: string, words: string) => `${path}\n${words.replace(/\s+$/, '')}`

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

export function embeddedPath(target: string, from: string | null): string | null {
  const root = workspace.rootHolding(from)
  if (root === null) return null
  const plain = target.split('#')[0] ?? target
  const found = links.targetOf(from, { kind: 'wikilink', target: plain })
  return found === null ? null : insideSpace(root, found)
}
