import { noteName } from './platform/src/api'

const ASSETS = 'assets'

export const ATTACHMENT_FOLDERS = ['space', 'note', 'named'] as const
export type AttachmentFolder = (typeof ATTACHMENT_FOLDERS)[number]

export function isAttachmentFolder(value: unknown): value is AttachmentFolder {
  return ATTACHMENT_FOLDERS.some((one) => one === value)
}

function slashed(path: string): string {
  return path.replace(/\\/g, '/')
}

export function attachmentFolder(
  choice: AttachmentFolder,
  notePath: string,
  spaceRoot: string | null,
): string {
  switch (choice) {
    case 'note':
      return ''
    case 'named':
      return noteName(slashed(notePath))
    case 'space': {
      const depth = foldersBelow(spaceRoot, notePath)
      return depth === null ? ASSETS : `${'../'.repeat(depth)}${ASSETS}`
    }
  }
}

function foldersBelow(spaceRoot: string | null, notePath: string): number | null {
  const root = slashed(spaceRoot ?? '').replace(/\/+$/, '')
  const note = slashed(notePath)
  if (!root || !note.startsWith(`${root}/`)) return null

  return note.slice(root.length + 1).split('/').length - 1
}
