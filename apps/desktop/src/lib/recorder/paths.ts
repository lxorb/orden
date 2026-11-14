import { folderOf, relativeTo } from '../platform/src/api'

export function spaceRelative(root: string, notePath: string, written: string): string | null {
  const folder = relativeTo(root, folderOf(notePath))
  if (folder.startsWith('/') || /^[a-z]:/i.test(folder)) return null

  const parts = folder ? folder.split('/') : []

  for (const step of written.split('/')) {
    if (!step || step === '.') continue
    if (step === '..') {
      if (!parts.length) return null
      parts.pop()
      continue
    }

    parts.push(step)
  }

  return parts.join('/')
}
