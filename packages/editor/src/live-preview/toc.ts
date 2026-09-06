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
        level: Number(match[1] ?? '1'),
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

  /** `from` counts, not only the text: each entry's link carries the position
   *  it scrolls to, so a heading that moved needs a new one. Without that, a
   *  paragraph typed above a heading leaves every entry below it pointing at
   *  where the heading used to be. */
  override eq(other: TocWidget) {
    if (other.entries.length !== this.entries.length) return false
    return this.entries.every((mine, index) => {
      const theirs = other.entries[index]
      return (
        !!theirs &&
        theirs.text === mine.text &&
        theirs.level === mine.level &&
        theirs.from === mine.from
      )
    })
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
