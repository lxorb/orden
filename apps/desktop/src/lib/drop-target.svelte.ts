import { folderFor } from './folder-notes'
import { folderOf, isMarkdownPath } from './platform/src/api'

export function targetFor(path: string, isFolder: boolean): string {
  if (isFolder) return path
  return isMarkdownPath(path) ? folderFor(path) : folderOf(path)
}

class DropTarget {
  folder = $state<string | null>(null)

  lit(folder: string): boolean {
    return !!this.folder && this.folder === folder
  }

  over(folder: string) {
    this.folder = folder
  }

  clear() {
    this.folder = null
  }
}

export const dropTarget = new DropTarget()
