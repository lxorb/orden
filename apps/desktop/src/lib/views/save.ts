import { canWriteAt } from '../sharing.svelte'
import { joinPath } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { openBaseFile } from './open'

function baseFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${cleaned || 'View'}.base`
}

export function copiesToBase(): boolean {
  const root = workspace.activeSpace?.root
  return root !== undefined && canWriteAt(root)
}

export async function copyToBase(yaml: string, name: string): Promise<string | null> {
  const root = workspace.activeSpace?.root
  if (root === undefined || !copiesToBase()) return null
  const path = joinPath(root, await workspace.freeNameOnDisk(root, baseFileName(name)))
  await writeFile(path, yaml)
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  openBaseFile(path)
  return path
}
