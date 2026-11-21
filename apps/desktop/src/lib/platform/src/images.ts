import { frontMatter } from '@orden/markdown/front-matter'
import { decodeTarget } from '@orden/markdown/links'
import { folderOf } from './space-paths'
import { assetUrl, joinPath } from './tauri'

const BASE: string = import.meta.env.VITE_ORDEN_API ?? 'https://orden.so'
const KEPT = /^(?:https?:)?\/\/(?:www\.|api\.)?(?:nibeditor\.com|orden\.so)\/i\/([\da-f]{64}(?:\.\w+)?)$/i
const AFAR = /^([a-z]+:)?\/\//i
export const isRemote = (src: string): boolean => AFAR.test(decodeTarget(src)) || src.startsWith('data:')
function remoteUrl(src: string) {
  const read = decodeTarget(src)
  const kept = KEPT.exec(read)?.[1]
  return kept ? `${BASE}/i/${kept}` : AFAR.test(src) || src.startsWith('data:') ? src : read
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
export function imagePath(
  src: string,
  notePath?: string | null,
  source = '',
  top: string | null = null,
): string | null {
  if (isRemote(src) || !notePath) return null
  const path = decodeTarget(src)
  const root = /^\s*typora-root-url\s*:\s*(.+)$/m.exec(frontMatter(source) ?? '')?.[1]
  const from = root ? root.trim().replace(/["']/g, '') : top
  if (from && path.startsWith('/')) return foldedPath(joinPath(from, path.slice(1)))
  return foldedPath(joinPath(folderOf(notePath), path))
}
export function imageUrl(src: string, notePath?: string | null, source = '', top: string | null = null): string {
  if (isRemote(src)) return remoteUrl(src)
  const path = imagePath(src, notePath, source, top)
  return path ? assetUrl(path) : src
}
