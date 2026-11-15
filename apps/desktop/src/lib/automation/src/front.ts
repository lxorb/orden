export const NOTE_WRITES = new Set([
  'ai-block',
  'convert-syntax',
  'extract-selection',
  'merge-into',
  'page-break',
  'picture',
  'reformat',
  'save',
  'split-at-caret',
])

export const NOTE_TREE = new Set([
  'archive',
  'convert-website-notes',
  'move-note',
  'move-to-space',
  'redo-file',
  'rename',
  'undo-file',
])

export function actsOnFrontNote(id: string): boolean {
  return (
    id.startsWith('export-') ||
    NOTE_WRITES.has(id) ||
    NOTE_TREE.has(id) ||
    /^(edit|format|paragraph)\./.test(id)
  )
}

export const FRONT_KEPT = (id: string) =>
  `${id} acts on the note in front, which is protected: the reader has to choose Let agents read in its menu`
