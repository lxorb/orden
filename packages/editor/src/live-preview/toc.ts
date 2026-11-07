import { OrdenWidget } from './widget'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { headingLevel, headingText } from '../headings'

export interface Heading {
  level: number
  text: string
  from: number
}

const NO_HEADINGS_INSIDE = new Set([
  'Paragraph',
  'FencedCode',
  'CodeBlock',
  'Table',
  'HTMLBlock',
  'CommentBlock',
  'FrontMatter',
])

export function headings(state: EditorState): Heading[] {
  const found: Heading[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      const level = headingLevel(node.name)
      if (level === null) return !NO_HEADINGS_INSIDE.has(node.name)

      found.push({ level, text: headingText(state.doc.lineAt(node.from).text), from: node.from })
      return false
    },
  })

  return found
}

export class TocWidget extends OrdenWidget {
  constructor(private readonly entries: Heading[]) {
    super()
  }

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
    nav.className = 'orden-toc'

    if (!this.entries.length) {
      nav.classList.add('orden-toc-empty')
      return nav
    }

    const top = this.entries.reduce((least, entry) => Math.min(least, entry.level), Infinity)

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
