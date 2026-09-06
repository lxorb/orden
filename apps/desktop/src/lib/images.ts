import { frontMatter } from '@nib/markdown'
import { assetUrl, folderOf, joinPath } from './tauri'

/** True for anything the browser can already fetch on its own. */
function isRemote(src: string): boolean {
  return /^([a-z]+:)?\/\//i.test(src) || src.startsWith('data:')
}

/** Where an image written in a note actually lives on disk.
 *
 *  `typora-root-url` re-bases absolute-looking paths, which is how Typora keeps
 *  a note working both inside a vault and on a site. Returns null when the path
 *  is not local, or when the note has no home yet. */
export function imagePath(src: string, notePath?: string | null, source = ''): string | null {
  if (isRemote(src) || !notePath) return null

  const root = /^\s*typora-root-url\s*:\s*(.+)$/m.exec(frontMatter(source) ?? '')?.[1]
  if (root && src.startsWith('/')) {
    return joinPath(root.trim().replace(/["']/g, ''), src.slice(1))
  }

  return joinPath(folderOf(notePath), src)
}

/** The same path, as something the webview will load. */
export function imageUrl(src: string, notePath?: string | null, source = ''): string {
  const path = imagePath(src, notePath, source)
  return path ? assetUrl(path) : src
}
