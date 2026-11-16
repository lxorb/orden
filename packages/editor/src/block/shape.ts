export type BlockShape =
  'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered' | 'task' | 'quote'

const INDENT = /^[ \t]*/

const QUOTED = /^(?:>[ \t]?)+/

const QUOTE_LEAD = /^[ \t]*(?:>[ \t]?)+/

const HASHES = /^#{1,6}[ \t]+/

const MARKER = /^(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/

export interface Words {
  lead: string
  indent: string
  words: string
}

export function wordsOf(text: string, listed = true, quoted = false): Words {
  const lead = quoted ? (QUOTE_LEAD.exec(text)?.[0] ?? '') : ''
  const rest = text.slice(lead.length)
  const indent = INDENT.exec(rest)?.[0] ?? ''
  const unquoted = rest.slice(indent.length).replace(QUOTED, '')
  const headed = HASHES.exec(unquoted)?.[0].length ?? 0
  const words = headed || !listed ? unquoted.slice(headed) : unquoted.replace(MARKER, '')

  return { lead, indent, words }
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

export function shaped(
  text: string,
  shape: BlockShape,
  nth = 1,
  listed = true,
  quoted = false,
): string {
  const { lead, indent, words } = wordsOf(text, listed, quoted)
  if (!words.trim()) return text

  return lead + indent + markFor(shape, nth) + words
}
