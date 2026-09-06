import { NibWidget } from './widget'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export interface Heading {
  level: number
  text: string
  from: number
}

const HEADING = /^(?:ATX|Setext)Heading(\d)$/

/** Every heading in the document, in order. */
export function headings(state: EditorState): Heading[] {
  const found: Heading[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      const match = HEADING.exec(node.name)
      if (!match) return true

      const line = state.doc.lineAt(node.from)
      found.push({
        level: Number(match[1]),
        text: line.text
          .replace(/^#{1,6}\s*/, '')
          .replace(/\s*#+\s*$/, '')
          .trim(),
        from: node.from,
      })
      return false
    },
  })

  return found
}

/** Typora's `[toc]`: a live table of contents that follows the headings. */
export class TocWidget extends NibWidget {
  constructor(private readonly entries: Heading[]) {
    super()
  }

  override eq(other: TocWidget) {
    return (
      other.entries.length === this.entries.length &&
      other.entries.every((entry, index) => {
        const mine = this.entries[index]
        return entry.text === mine.text && entry.level === mine.level
      })
    )
  }

  toDOM(view: EditorView) {
    const nav = document.createElement('nav')
    nav.className = 'nib-toc'

    if (!this.entries.length) {
      nav.classList.add('nib-toc-empty')
      return nav
    }

    const top = Math.min(...this.entries.map((entry) => entry.level))

    for (const entry of this.entries) {
      const link = document.createElement('a')
      link.textContent = entry.text
      link.href = '#'
      link.style.paddingLeft = `${(entry.level - top) * 1.1}em`

      link.addEventListener('mousedown', (event) => {
        event.preventDefault()
        view.dispatch({
          selection: { anchor: entry.from },
          effects: EditorView.scrollIntoView(entry.from, { y: 'start', yMargin: 72 }),
        })
        view.focus()
      })

      nav.append(link)
    }

    return nav
  }
}
