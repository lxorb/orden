import { isNumber, isRecord, isString, invoke } from '../../platform/src/api'

const A_PAPER = 2_000_000

const ALL_PAPERS = 16_000_000

let aPaper = A_PAPER
let allPapers = ALL_PAPERS

export function keepAtMost(perPaper: number, inAll: number): void {
  aPaper = perPaper
  allPapers = inAll
}

export interface PaperText {
  path: string
  hash: string
  modified: number
  pages: [number, string][]
  characters: number
}

export interface PaperFile {
  path: string
  size: number
}

const work = { read: 0, wrote: 0 }

export function textWork(): { read: number; wrote: number } {
  const done = { ...work }
  work.read = 0
  work.wrote = 0
  return done
}

function isPages(value: unknown): value is [number, string][] {
  return (
    Array.isArray(value) &&
    value.every(
      (one) => Array.isArray(one) && one.length === 2 && isNumber(one[0]) && isString(one[1]),
    )
  )
}

function isPaperText(value: unknown): value is PaperText {
  if (!isRecord(value)) return false

  return (
    isString(value.path) &&
    isString(value.hash) &&
    isNumber(value.modified) &&
    isNumber(value.characters) &&
    isPages(value.pages)
  )
}

function isPaperFile(value: unknown): value is PaperFile {
  return isRecord(value) && isString(value.path) && isNumber(value.size)
}

export function paperTextOf(
  path: string,
  hash: string,
  modified: number,
  pages: Iterable<[number, string]>,
): PaperText {
  const kept: [number, string][] = []
  let characters = 0

  for (const [page, text] of [...pages].sort((one, other) => one[0] - other[0])) {
    if (characters + text.length > aPaper) break

    kept.push([page, text])
    characters += text.length
  }

  return { path, hash, modified, pages: kept, characters }
}

export async function paperFiles(): Promise<PaperFile[]> {
  const found = await invoke<unknown>('list_paper_texts').catch(() => null)
  if (!Array.isArray(found)) return []

  return found.filter(isPaperFile).sort((one, other) => one.size - other.size)
}

export async function paperText(
  path: string,
  modified?: number,
  hash?: string,
): Promise<PaperText | null> {
  work.read += 1
  const text = await invoke<unknown>('read_paper_text', { path }).catch(() => '')
  if (!isString(text) || !text) return null

  let found: unknown
  try {
    found = JSON.parse(text)
  } catch {
    return null
  }

  if (!isPaperText(found)) return null
  if (modified !== undefined && found.modified !== modified) return null
  if (hash !== undefined && found.hash !== hash) return null

  return found
}

export async function keepPaperText(record: PaperText): Promise<void> {
  work.wrote += 1
  await invoke('write_paper_text', {
    path: record.path,
    content: JSON.stringify(record),
  }).catch(() => undefined)

  await holdPapers(record.path, record.characters)
}

export async function forgetPaperText(path: string): Promise<void> {
  await invoke('write_paper_text', { path, content: '' }).catch(() => undefined)
}

async function holdPapers(keep: string, size: number): Promise<void> {
  if (size >= allPapers) return

  const files = await paperFiles()
  let held = files.reduce((sum, one) => sum + one.size, 0)

  for (const file of [...files].reverse()) {
    if (held <= allPapers) break
    if (file.path === keep) continue

    await forgetPaperText(file.path)
    held -= file.size
  }
}
