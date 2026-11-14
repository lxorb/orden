import { insideOnly } from './inside'
import { endingOf } from '@orden/markdown/note-name'
import { invoke, isNative, joinPath, platform } from './tauri'

const folding = new Map<string, boolean>()

function foldsHere(): boolean {
  const os = platform()
  return os === 'windows' || os === 'macos' || os === 'ios'
}

function steps(path: string): string[] {
  const out = path.split(/[\\/]+/)
  while (out.length > 1 && out.at(-1) === '') out.pop()
  return out
}

function sameName(one: string, other: string, folds: () => boolean): boolean {
  if (one === other) return true

  const a = one.normalize('NFC')
  const b = other.normalize('NFC')
  return a === b || (a.toLowerCase() === b.toLowerCase() && folds())
}

function foldsAt(path: string): boolean {
  for (const [root, folds] of folding) {
    if (holds(steps(root), steps(path), () => true)) return folds
  }

  return foldsHere()
}

function holds(head: readonly string[], file: readonly string[], folds: () => boolean): boolean {
  return head.length <= file.length && head.every((one, at) => sameName(one, file[at] ?? '', folds))
}

export function samePath(
  one: string | null | undefined,
  other: string | null | undefined,
  root?: string,
): boolean {
  if (one === other) return true
  if (one == null || other == null) return false

  const a = steps(one)
  const b = steps(other)
  return a.length === b.length && holds(a, b, () => foldsAt(root ?? one))
}

export const foldsIn = (root: string): boolean => foldsAt(root)

export function rootedAt<T extends { readonly root: string }>(
  spaces: Iterable<T>,
  root: string | null | undefined,
): T | undefined {
  for (const one of spaces) if (samePath(one.root, root)) return one
  return undefined
}

export function pathKeyAs(path: string, folds: boolean): string {
  const key = steps(path)
    .map((one) => one.normalize('NFC'))
    .join('/')
  return folds ? key.toLowerCase() : key
}

export function pathKey(path: string, root?: string): string {
  return pathKeyAs(path, foldsAt(root ?? path))
}

export function pathKeys(paths: Iterable<string>, root?: string): Set<string> {
  return new Set([...paths].map((one) => pathKey(one, root)))
}

export function sameSpelling(one: string, other: string): boolean {
  const a = steps(one)
  const b = steps(other)
  return a.length === b.length && holds(a, b, () => false)
}

export function within(folder: string, path: string, root?: string): string | null {
  if (!folder) return path.replace(/\\/g, '/')

  if (path.startsWith(folder) && !/[\\/]$/.test(folder)) {
    const rest = path.slice(folder.length)
    if (!rest || /^[\\/]/.test(rest))
      return rest
        .split(/[\\/]+/)
        .filter(Boolean)
        .join('/')
  }

  const head = steps(folder)
  const file = steps(path)
  return holds(head, file, () => foldsAt(root ?? folder)) ? file.slice(head.length).join('/') : null
}

export function movedTo(path: string, from: string, to: string, root?: string): string | null {
  const rest = within(from, path, root)
  if (rest === null) return null
  if (!rest) return to

  return to ? joinPath(to, rest) : rest
}

export async function askCase(root: string, files: readonly string[]): Promise<void> {
  if (!isNative || folding.has(root)) return

  const probe = files.find((path) => turned(nameOf(path)) !== nameOf(path))
  if (probe === undefined) return

  const other = joinPath(folderOf(probe), turned(nameOf(probe)))
  const found = await invoke<unknown>('file_stamp', { path: other }).catch(() => null)
  folding.set(root, found !== null && found !== undefined)
}

function turned(name: string): string {
  return name.replace(/\p{L}/gu, (one) =>
    one === one.toLowerCase() ? one.toUpperCase() : one.toLowerCase(),
  )
}

export function answeredCase(root: string, folds: boolean | null): void {
  if (folds === null) folding.delete(root)
  else folding.set(root, folds)
}

export function relativeTo(root: string, path: string): string {
  return (root ? within(root, path) : null) ?? path.replace(/\\/g, '/')
}

export function withinSpace(root: string, path: string): string | null {
  const rest = root ? within(root, path) : null
  return rest ? insideOnly(rest) : null
}

export function insideSpace(root: string, relative: string): string {
  return joinPath(root, relative)
}

export function placesOf(file: string, notePath: string | null, root: string | null): string[] {
  if (!file) return []
  if (/^[/\\]/.test(file) || /^[A-Za-z]:/.test(file)) return [file]

  const out: string[] = []
  const add = (path: string) => {
    if (!out.includes(path)) out.push(path)
  }

  if (notePath) {
    const folder = folderOf(notePath)
    add(folder ? joinPath(folder, file) : file)
  }
  if (root) add(insideSpace(root, file))
  if (!out.length) add(file)

  return out
}

const LONGEST_PATH = 300

export function insideItsSpace(path: string): boolean {
  return (
    !!path &&
    path.length <= LONGEST_PATH &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !/^[A-Za-z]:/.test(path) &&
    !/\p{Cc}/u.test(path) &&
    !path.split('/').includes('..')
  )
}

export function insideAnyOf(roots: readonly string[], said: string): string | null {
  const folded = said.replace(/\\/g, '/').trim()

  for (const root of roots) {
    if (!root) continue

    const head = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!folded.startsWith(`${head}/`)) continue

    const safe = insideOnly(folded.slice(head.length).replace(/^\/+/, ''))
    if (safe) return insideSpace(root, safe)
  }

  return null
}

function cut(path: string): number {
  return Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
}

export function folderOf(path: string): string {
  return path.slice(0, Math.max(0, cut(path)))
}

export function nameOf(path: string): string {
  return path.slice(cut(path) + 1)
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

export function noteName(relative: string): string {
  return nameOf(relative).replace(MARKDOWN, '')
}

export function withoutExtension(relative: string): string {
  return relative.replace(MARKDOWN, '')
}

export function isHiddenPath(relative: string): boolean {
  return relative.split('/').some((part) => part.startsWith('.'))
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN.test(path)
}

export function notePath(named: string): string | null {
  if (isMarkdownPath(named)) return named
  const ending = endingOf(nameOf(named))
  if (ending !== null && !/^\.\d+$/.test(ending)) return null
  return `${named}.md`
}

const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i

export function isPicturePath(path: string): boolean {
  return PICTURE.test(path)
}

export function relativePath(fromFolder: string, to: string): string {
  const here = fromFolder ? fromFolder.split('/') : []
  const there = to.split('/')

  let shared = 0
  while (shared < here.length && shared < there.length - 1 && here[shared] === there[shared]) {
    shared++
  }

  const up = Array.from({ length: here.length - shared }, () => '..')
  return [...up, ...there.slice(shared)].join('/')
}
