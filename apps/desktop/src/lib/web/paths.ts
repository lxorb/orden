const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

export function normalise(path: string): string {
  const parts = path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')

  const out: string[] = []
  for (const part of parts) {
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

export function hiddenUnder(root: string, path: string): boolean {
  const base = normalise(root)
  const at = normalise(path)
  const inside = base === '/' ? at.slice(1) : at.slice(base.length + 1)
  return inside.split('/').some((part) => part.startsWith('.'))
}

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

export function isCanvas(path: string): boolean {
  return /\.canvas$/i.test(path)
}

export function isPages(path: string): boolean {
  return /\.pages$/i.test(path)
}

export function spaceOf(path: string): string {
  const segment = normalise(path).split('/')[1]
  return segment ? `/${segment}` : '/'
}

export function safeName(input: string): string | null {
  const cleaned = input
    .split('')
    .map((c) => (c < ' ' || `<>:"/\\|?*`.includes(c) ? ' ' : c))
    .join('')

  const collapsed = cleaned.split(/\s+/).filter(Boolean).join(' ')
  const trimmed = collapsed.replace(/^[.\s]+|[.\s]+$/g, '')

  return trimmed ? trimmed.slice(0, 64) : null
}
