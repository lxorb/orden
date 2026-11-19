import { insideOnly } from './inside'
import { endingOf } from '@orden/markdown/note-name'
import { invoke, isNative, joinPath, platform } from './tauri'

const folding = new Map<string, boolean>()

const foldsHere = () => ['windows', 'macos', 'ios'].includes(platform())

function steps(path: string): string[] {
  const out = path.split(/[\\/]+/)
  while (out.length > 1 && out.at(-1) === '') out.pop()
  return out
}

function caseless(name: string): string {
  let out = ''
  for (const one of name) {
    const upper = one.toUpperCase()
    if (Array.from(upper).length !== 1) {
      out += one
      continue
    }
    const lower = upper.toLowerCase()
    out += Array.from(lower).length === 1 ? lower : upper
  }
  return out
}

function spelled(name: string, last: boolean): string {
  const one = name.normalize('NFC')
  if (!/[. ]$/.test(one) || platform() !== 'windows' || /^\.*$/.test(one)) return one
  return one.replace(last ? /[. ]+$/ : /\.$/, '')
}

function sameName(one: string, other: string, folds: () => boolean, last: boolean): boolean {
  if (one === other) return true

  const a = spelled(one, last)
  const b = spelled(other, last)
  return a === b || (caseless(a) === caseless(b) && folds())
}

function foldsAt(path: string): boolean {
  for (const [root, folds] of folding) {
    if (holds(steps(root), steps(path), () => true)) return folds
  }

  return foldsHere()
}

const holds = (head: readonly string[], file: readonly string[], folds: () => boolean): boolean =>
  head.length <= file.length && head.every((one, at) => sameName(one, file[at] ?? '', folds, at === file.length - 1))

export function samePath(one: string | null | undefined, other: string | null | undefined, root?: string): boolean {
  if (one === other) return true
  if (one == null || other == null) return false

  const a = steps(one)
  const b = steps(other)
  return a.length === b.length && holds(a, b, () => foldsAt(root ?? one))
}

export const foldsIn = foldsAt

export function rootedAt<T extends { readonly root: string }>(
  spaces: Iterable<T>,
  root: string | null | undefined,
): T | undefined {
  for (const one of spaces) if (samePath(one.root, root)) return one
  return undefined
}

export function pathKeyAs(path: string, folds: boolean): string {
  const parts = steps(path)
  const key = parts.map((one, at) => spelled(one, at === parts.length - 1)).join('/')
  return folds ? caseless(key) : key
}

export const pathKey = (path: string, root?: string) => pathKeyAs(path, foldsAt(root ?? path))

export const pathKeys = (paths: Iterable<string>, root?: string) => new Set([...paths].map((one) => pathKey(one, root)))

export function sameSpelling(one: string, other: string): boolean {
  const a = steps(one)
  const b = steps(other)
  return a.length === b.length && holds(a, b, () => false)
}

const inward = (parts: readonly string[]) => (parts.includes('..') ? null : parts.join('/'))

export function within(folder: string, path: string, root?: string): string | null {
  if (!folder) return path.replace(/\\/g, '/')

  if (path.startsWith(folder) && !/[\\/]$/.test(folder)) {
    const rest = path.slice(folder.length)
    if (!rest || /^[\\/]/.test(rest)) return inward(rest.split(/[\\/]+/).filter(Boolean))
  }

  const head = steps(folder)
  const file = steps(path)
  return holds(head, file, () => foldsAt(root ?? folder)) ? inward(file.slice(head.length)) : null
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

const turned = (name: string) =>
  name.replace(/\p{L}/gu, (one) => (one === one.toLowerCase() ? one.toUpperCase() : one.toLowerCase()))

export function answeredCase(root: string, folds: boolean | null): void {
  if (folds === null) folding.delete(root)
  else folding.set(root, folds)
}

export const relativeTo = (root: string, path: string) => (root ? within(root, path) : null) ?? path.replace(/\\/g, '/')

export const spaceHolding = <Space extends { readonly root: string }>(
  spaces: readonly Space[],
  path: string,
): Space | null => spaces.find((one) => within(one.root, path) !== null) ?? null

export function withinSpace(root: string, path: string): string | null {
  const rest = root ? within(root, path) : null
  return rest ? insideOnly(rest) : null
}

export const insideSpace = (root: string, relative: string) => joinPath(root, relative)

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

export const insideItsSpace = (path: string): boolean =>
  !!path &&
  path.length <= LONGEST_PATH &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !/^[A-Za-z]:/.test(path) &&
  !/\p{Cc}/u.test(path) &&
  !path.split('/').includes('..')

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

const cut = (path: string) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

export const folderOf = (path: string) => path.slice(0, Math.max(0, cut(path)))

export const nameOf = (path: string) => path.slice(cut(path) + 1)

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

export const noteName = (relative: string) => nameOf(relative).replace(MARKDOWN, '')

export const withoutExtension = (relative: string) => relative.replace(MARKDOWN, '')

export const isHiddenPath = (relative: string) => relative.split('/').some((part) => part.startsWith('.'))

export const isMarkdownPath = (path: string) => MARKDOWN.test(path)

export function notePath(named: string): string | null {
  if (isMarkdownPath(named)) return named
  const ending = endingOf(nameOf(named))
  if (ending !== null && !/^\.\d+$/.test(ending)) return null
  return `${named}.md`
}

export const isPicturePath = (path: string) => /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(path)

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

export const KEPT_HOME = '.orden'

export function keptShaped(root: string): boolean {
  const parts = steps(root.replace(/\\/g, '/'))
  const name = parts.at(-1)
  return parts.length > 2 && parts.at(-3) === KEPT_HOME && !!name && parts.at(-2) === name
}

export function coveredBy(keys: ReadonlySet<string>, at: string): string | null {
  if (!keys.size) return null

  for (let path = at; ;) {
    if (keys.has(path)) return path
    const cut = path.lastIndexOf('/')
    if (cut === -1) return null
    path = path.slice(0, cut)
  }
}
