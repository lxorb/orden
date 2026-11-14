import { isPagesTarget } from '@orden/markdown/links'
import { holderOf, paperOf } from '@orden/markdown/pages'
import { type Hit, Matcher } from '@orden/scan/search/match'
import type { Query } from '@orden/scan/search/query'
import type { PapersHeld } from '@orden/scan/search/warmth'
import { folderOf, pathKey, pathKeys, afterQuiet } from '../../platform/src/api'
import { forgetPaperText, keepPaperText, paperFiles, paperText, paperTextOf } from './text-cache'

interface Paper {
  hash: string
  modified: number
  pages: Map<number, string>
  characters: number
  unwritten: boolean
}

const held = new Map<string, Paper>()

const IN_MEMORY = 4_000_000

const SETTLE = 1500

const WINDOW = 180
const BEFORE = 60

const writing = afterQuiet(() => void writePapers(), SETTLE)

let hydrated: { root: string; at: number; done: Promise<void> } | null = null

let listing: {
  root: string
  at: number
  modified: Map<string, number>
  walked: { notes: Set<string>; folders: Set<string> } | null
} | null = null

export interface Walked {
  notes: readonly string[]
  folders: readonly string[]
}
let listings = 0

function listedAt(root: string, path: string): number | undefined {
  return listing?.root === root ? listing.modified.get(path) : undefined
}

function orphaned(root: string, path: string): boolean {
  const holder = holderOf(path)
  const walked = listing?.root === root ? listing.walked : null
  if (holder === null || !walked || listing?.modified.has(path)) return false

  const inside = root.endsWith('/') ? root : `${root}/`
  if (!path.startsWith(inside) || !walked.folders.has(pathKey(folderOf(path)))) return false

  return !walked.notes.has(pathKey(holder))
}

const letGone = new Set<string>()

let walking = 0

function letGo(path: string): void {
  held.delete(path)
  if (walking) letGone.add(path)
}

function letGoOf(path: string): boolean {
  for (const one of letGone) {
    if (path === one || path.startsWith(`${one}/`)) return true
  }

  return false
}

export function paperOpened(path: string, hash: string, modified: number): void {
  const paper = paperAt(path)
  if (paper.hash === hash && paper.modified === modified) return

  if (paper.hash && paper.hash !== hash) {
    paper.pages.clear()
    paper.characters = 0
    void forgetPaperText(path)
  }

  paper.hash = hash
  paper.modified = modified
}

function paperAt(path: string): Paper {
  const found = held.get(path)
  if (found) return found

  const made: Paper = { hash: '', modified: 0, pages: new Map(), characters: 0, unwritten: false }
  held.set(path, made)
  return made
}

export function paperRead(path: string, page: number, runs: readonly string[]): void {
  const text = runs.join(' ')
  const paper = paperAt(path)
  const was = paper.pages.get(page)
  if (was === text) return

  paper.pages.set(page, text)
  paper.characters += text.length - (was?.length ?? 0)
  paper.unwritten = true

  hold()
  told()
  writing()
}

export async function writePapers(): Promise<void> {
  writing.cancel()

  for (const [path, paper] of held) {
    if (!paper.unwritten || !paper.hash || !paper.pages.size) continue

    paper.unwritten = false
    await keepPaperText(paperTextOf(path, paper.hash, paper.modified, paper.pages))
  }
}

export function papersListed(
  root: string,
  modified: Map<string, number>,
  walked?: Walked | null,
): void {
  listing = {
    root,
    at: ++listings,
    modified,
    walked: walked ? { notes: pathKeys(walked.notes), folders: pathKeys(walked.folders) } : null,
  }

  let dropped = false
  for (const [path, paper] of [...held]) {
    if (orphaned(root, path)) {
      letGo(path)
      void forgetPaperText(path)
      dropped = true
      continue
    }

    if (!paper.hash) continue

    const stamp = modified.get(path)
    if (stamp === undefined || stamp === paper.modified) continue

    held.delete(path)
    dropped = true
  }

  if (dropped) told()
}

export async function papersFor(root: string): Promise<void> {
  const at = listing?.root === root ? listing.at : 0
  if (hydrated?.root === root && hydrated.at === at) return hydrated.done

  const done = (async () => {
    walking += 1
    try {
      const inside = root.endsWith('/') ? root : `${root}/`

      for (const file of await paperFiles()) {
        if (!file.path.startsWith(inside)) continue
        if (characters() + file.size > IN_MEMORY) break
        if (held.get(file.path)?.pages.size) continue

        if (orphaned(root, file.path)) {
          void forgetPaperText(file.path)
          continue
        }

        const record = await paperText(file.path)
        if (!record) continue

        const stamp = listedAt(root, file.path)
        if (stamp !== undefined && record.modified !== stamp) continue

        if (letGoOf(file.path)) continue

        const paper = paperAt(file.path)
        paper.hash = record.hash
        paper.modified = record.modified
        for (const [page, text] of record.pages) paper.pages.set(page, text)
        paper.characters = record.characters
        paper.unwritten = false
      }

      told()
    } finally {
      walking -= 1
      if (!walking) letGone.clear()
    }
  })()

  hydrated = { root, at, done }
  return done
}

export function paperGone(path: string): void {
  for (const one of withPaper(path)) {
    for (const inside of heldUnder(one)) letGo(inside)
    letGo(one)
    void forgetPaperText(one)
    void forgetStored(one)
  }
  told()
}

function withPaper(path: string): string[] {
  return isPagesTarget(path) ? [path, paperOf(path)] : [path]
}

function under(path: string, at: string): boolean {
  return path === at || path.startsWith(`${at}/`)
}

function heldUnder(at: string): string[] {
  return [...held.keys()].filter((path) => under(path, at))
}

async function forgetStored(at: string): Promise<void> {
  for (const file of await paperFiles()) {
    if (file.path !== at && under(file.path, at)) await forgetPaperText(file.path)
  }
}

export function paperMoved(from: string, to: string): void {
  if (isPagesTarget(from)) paperMoved(paperOf(from), paperOf(to))

  const same = pathKey(from) === pathKey(to)
  const moving = heldUnder(from)

  for (const path of moving) {
    const paper = held.get(path)
    if (!paper) continue

    held.delete(path)
    held.set(to + path.slice(from.length), { ...paper, unwritten: true })
    if (!same) void forgetPaperText(path)
  }

  letGo(from)

  if (!same) void moveStored(from, to, new Set(moving))
  if (!moving.length) return

  told()
  void writePapers()
}

async function moveStored(from: string, to: string, moved: ReadonlySet<string>): Promise<void> {
  for (const file of await paperFiles()) {
    if (moved.has(file.path) || !under(file.path, from)) continue

    const record = await paperText(file.path)
    const there = to + file.path.slice(from.length)
    if (record && !held.has(there)) await keepPaperText({ ...record, path: there })
    await forgetPaperText(file.path)
  }
}

let hearing: ((held: PapersHeld) => void) | null = null

let toldOnce = false

export function hearPapers(hear: (held: PapersHeld) => void): void {
  hearing = hear
  if (toldOnce) hear(papersHeld())
}

function told(): void {
  toldOnce = true
  hearing?.(papersHeld())
}

export function papersHeld(): PapersHeld {
  return { papers: papersRead(), characters: characters(), cap: IN_MEMORY }
}

export function papersRead(): number {
  let read = 0
  for (const paper of held.values()) {
    if (paper.pages.size) read += 1
  }

  return read
}

function characters(): number {
  let sum = 0
  for (const paper of held.values()) sum += paper.characters
  return sum
}

function hold(): void {
  if (characters() <= IN_MEMORY) return

  const biggest = [...held.entries()].sort((one, other) => other[1].characters - one[1].characters)
  for (const [path, paper] of biggest) {
    if (characters() <= IN_MEMORY) return
    if (paper.unwritten) continue

    held.delete(path)
  }
}

function windowOf(body: string, from: number): { text: string; at: number } {
  const start = Math.max(0, from - BEFORE)
  const cut = body.slice(start, start + WINDOW)
  const lead = cut.length - cut.trimStart().length
  const text = cut.trim()

  return { text, at: from - start - lead }
}

function leftOut(relative: string, excluded: readonly string[]): boolean {
  return excluded.some((one) => relative === one || relative.startsWith(`${one}/`))
}

export function searchPapers(
  root: string,
  query: Query,
  limit: number,
  excluded: readonly string[] = [],
): Hit[] {
  if (!held.size || limit <= 0) return []

  const matcher = new Matcher(query)
  const out: Hit[] = []
  const inside = root.endsWith('/') ? root : `${root}/`

  for (const [path, paper] of held) {
    if (out.length >= limit) break
    if (!path.startsWith(inside)) continue

    const relative = path.slice(inside.length)
    if (leftOut(relative, excluded)) continue

    const file = relative.split('/').pop() ?? relative
    const name = holderOf(file) ?? file

    for (const [page, body] of [...paper.pages].sort((one, other) => one[0] - other[0])) {
      if (out.length >= limit) break
      if (!body.trim()) continue

      const spans = matcher.spans({ path, relative, name, body })
      if (!spans) continue

      const first = spans[0]
      const { text, at } = first
        ? windowOf(body, first.from)
        : { text: body.slice(0, WINDOW).trim(), at: -1 }

      const length = first ? first.to - first.from : 0
      out.push({
        path,
        name,
        page,
        line: 0,
        text,
        ranges: at >= 0 && length > 0 ? [{ from: at, to: at + length }] : [],
      })
    }
  }

  return out
}

export function forgetPapers(): void {
  held.clear()
  hydrated = null
  listing = null
  letGone.clear()
  walking = 0
  writing.cancel()
}
