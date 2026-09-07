/** Path arithmetic for the browser's virtual disk. Everything uses `/`, and a
 *  space is a folder directly under the root. */

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

export function normalise(path: string): string {
  const parts = path
    .replace(/\\/g, '/')
    // Interior runs collapse too, so joining a path that already ends in a
    // slash to one that starts with one does not leave `//` behind.
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')

  const out: string[] = []
  for (const part of parts) {
    // Folded down to where the path points, so `a/../b` and `b` are one path
    // rather than two. Climbing above the root names no place, so it stops
    // there; there is nothing outside the virtual disk to reach.
    if (part === '.' || part === '') continue
    if (part === '..') out.pop()
    else out.push(part)
  }

  return `/${out.join('/')}`
}

export function basename(path: string): string {
  return normalise(path).split('/').pop() ?? ''
}

export function parent(path: string): string {
  const parts = normalise(path).split('/')
  parts.pop()
  return parts.join('/') || '/'
}

export function join(dir: string, name: string): string {
  return normalise(`${normalise(dir)}/${name}`)
}

/** True when `path` sits anywhere under `root`. */
export function within(root: string, path: string): boolean {
  const base = normalise(root)
  return base === '/' || normalise(path).startsWith(`${base}/`)
}

export function isMarkdown(path: string): boolean {
  return MARKDOWN.test(path)
}

export function isPdf(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/** The space a path belongs to: the first segment under the root. */
export function spaceOf(path: string): string {
  const segment = normalise(path).split('/')[1]
  return segment ? `/${segment}` : '/'
}

/** Makes a name every platform would accept, so notes written in the browser
 *  keep working if the same space is later synced to a real disk. */
export function safeName(input: string): string | null {
  const cleaned = input
    .split('')
    .map((c) => (c < ' ' || `<>:"/\\|?*`.includes(c) ? ' ' : c))
    .join('')

  const collapsed = cleaned.split(/\s+/).filter(Boolean).join(' ')
  const trimmed = collapsed.replace(/^[.\s]+|[.\s]+$/g, '')

  return trimmed ? trimmed.slice(0, 64) : null
}
