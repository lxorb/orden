export type BlockShape =
  'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered' | 'task' | 'quote'

const INDENT = /^[ \t]*/

const QUOTED = /^(?:>[ \t]?)+/

const HASHES = /^#{1,6}[ \t]+/

const MARKER = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/

export function wordsOf(text: string): { indent: string; words: string } {
  const indent = INDENT.exec(text)?.[0] ?? ''
  const words = text
    .slice(indent.length)
    .replace(QUOTED, '')
    .replace(HASHES, '')
    .replace(MARKER, '')

  return { indent, words }
}

function markFor(shape: BlockShape, nth: number): string {
  switch (shape) {
    case 'heading1':
      return '# '
    case 'heading2':
      return '## '
    case 'heading3':
      return '### '
    case 'paragraph':
      return ''
    case 'bullet':
      return '- '
    case 'numbered':
      return `${nth}. `
    case 'task':
      return '- [ ] '
    case 'quote':
      return '> '
  }
}

export function shaped(text: string, shape: BlockShape, nth = 1): string {
  const { indent, words } = wordsOf(text)
  if (!words.trim()) return text

  return indent + markFor(shape, nth) + words
}
