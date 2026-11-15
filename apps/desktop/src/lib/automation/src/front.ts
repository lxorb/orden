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

const ACROSS_SPACE = new Set(['convert-website-notes', 'redo-file', 'undo-file'])

function actsOnFrontNote(id: string): boolean {
  return (
    id.startsWith('export-') ||
    NOTE_WRITES.has(id) ||
    (NOTE_TREE.has(id) && !ACROSS_SPACE.has(id)) ||
    /^(edit|format|paragraph)\./.test(id)
  )
}

function actsAcrossSpace(id: string): boolean {
  return id.startsWith('export-') || ACROSS_SPACE.has(id)
}

export interface AgentsMay {
  front: boolean
  space: boolean
}

export function keptFromAgents(id: string, may: AgentsMay): string | null {
  if (actsOnFrontNote(id) && !may.front) {
    return `${id} acts on the note in front, which is protected: the reader has to choose Let agents read in its menu`
  }
  if (actsAcrossSpace(id) && !may.space) {
    return `${id} reaches notes in this space that are protected from agents`
  }
  return null
}
