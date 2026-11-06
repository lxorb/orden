import { frontMatter } from '@orden/markdown/front-matter'
import { decodeTarget } from '@orden/markdown/links'
import { folderOf } from './space-paths'
import { assetUrl, joinPath } from './tauri'

function isRemote(src: string): boolean {
  return /^([a-z]+:)?\/\//i.test(src) || src.startsWith('data:')
}

function written(src: string): string {
  return decodeTarget(src)
}

function foldedPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const out: string[] = []

  for (const part of path.split(/[\\/]/)) {
    if (part === '.') continue
    if (part === '..' && out.length > 1 && out.at(-1) !== '..') out.pop()
    else out.push(part)
  }

  return out.join(separator)
}

export function imagePath(src: string, notePath?: string | null, source = ''): string | null {
  if (isRemote(src) || !notePath) return null

  const path = written(src)
  const root = /^\s*typora-root-url\s*:\s*(.+)$/m.exec(frontMatter(source) ?? '')?.[1]
  if (root && path.startsWith('/')) {
    return foldedPath(joinPath(root.trim().replace(/["']/g, ''), path.slice(1)))
  }

  return foldedPath(joinPath(folderOf(notePath), path))
}

export function imageUrl(src: string, notePath?: string | null, source = ''): string {
  const path = imagePath(src, notePath, source)
  return path ? assetUrl(path) : src
}
