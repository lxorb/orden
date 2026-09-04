import { Compartment, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { commonmarkLanguage, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { livePreview } from './live-preview'
import { mermaidDescription } from './mermaid'
import { numberEquations } from './live-preview/blocks'
import { nibMarkdownExtensions } from './markdown/extensions'
import { closeBrackets } from '@codemirror/autocomplete'
import { flushTableEdits } from './table/widget'
import { smartPunctuation } from './typography'

/** Each mode lives in its own compartment so it can be swapped at runtime
 *  without rebuilding the editor state. */
const preview = new Compartment()
const focus = new Compartment()
const typewriter = new Compartment()
const punctuation = new Compartment()
const language = new Compartment()
const equations = new Compartment()
const spelling = new Compartment()
const brackets = new Compartment()

/** Strict mode drops GFM and the Typora extensions, leaving plain CommonMark -
 *  useful when a document has to render the same everywhere. */
function markdownFor(strict: boolean) {
  return markdown({
    base: strict ? commonmarkLanguage : markdownLanguage,
    codeLanguages: [...languages, mermaidDescription],
    extensions: strict ? [] : nibMarkdownExtensions,
  })
}

const dim = Decoration.line({ class: 'nib-dim' })

/** Dims every block except the one holding the caret. */
const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    private build(view: EditorView): DecorationSet {
      const { state } = view
      const head = state.selection.main.head
      const block = enclosingBlock(state, head)
      const ranges = []

      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = state.doc.lineAt(pos)
          if (line.to < block.from || line.from > block.to) ranges.push(dim.range(line.from))
          if (line.to >= state.doc.length) break
          pos = line.to + 1
        }
      }

      return Decoration.set(ranges, true)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** The paragraph, list or fence the caret sits in - Typora dims by block, not line. */
function enclosingBlock(state: EditorView['state'], pos: number) {
  let node = syntaxTree(state).resolveInner(pos, -1)

  while (node.parent && node.parent.name !== 'Document') node = node.parent
  if (node.name === 'Document') {
    const line = state.doc.lineAt(pos)
    return { from: line.from, to: line.to }
  }

  return { from: node.from, to: node.to }
}

/** Keeps the caret's line parked in the middle of the viewport. */
const typewriterPlugin = EditorView.updateListener.of((update) => {
  if (!update.docChanged && !update.selectionSet) return

  const view = update.view
  const head = view.state.selection.main.head
  const block = view.lineBlockAt(head)
  const middle = view.scrollDOM.clientHeight / 2
  const offset = block.top - view.scrollDOM.scrollTop - middle + block.height / 2

  if (Math.abs(offset) < 1) return
  view.scrollDOM.scrollTop += offset
})

export function modeExtensions(): Extension {
  return [
    language.of(markdownFor(false)),
    preview.of(livePreview()),
    focus.of([]),
    typewriter.of([]),
    punctuation.of(smartPunctuation()),
    equations.of(numberEquations.of(false)),
    // Off until asked for: a checker's wavy lines under prose that is not in
    // its dictionary's language are noise, and most notes start that way.
    spelling.of(EditorView.contentAttributes.of({ spellcheck: 'false' })),
    brackets.of(closeBrackets()),
  ]
}

export function setStrictMode(view: EditorView, on: boolean) {
  // Strict mode has no tables; a cell still being typed in would go with them.
  flushTableEdits()
  view.dispatch({ effects: language.reconfigure(markdownFor(on)) })
}

/** Numbers display equations and lets `\eqref` point at them. */
export function setEquationNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: equations.reconfigure(numberEquations.of(on)) })
}

/** Source mode shows the markdown as written, with no syntax hidden. */
export function setSourceMode(view: EditorView, on: boolean) {
  flushTableEdits()
  view.dispatch({ effects: preview.reconfigure(on ? [] : livePreview()) })
}

export function setFocusMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: focus.reconfigure(on ? focusPlugin : []) })
  view.dom.classList.toggle('nib-focus-mode', on)
}

export function setTypewriterMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: typewriter.reconfigure(on ? typewriterPlugin : []) })
  // Extra room below the last line, so the caret can still reach the middle.
  view.dom.classList.toggle('nib-typewriter-mode', on)
}

/** Curly quotes, en and em dashes, ellipsis - on by default, like Typora. */
export function setSmartPunctuation(view: EditorView, on: boolean) {
  view.dispatch({ effects: punctuation.reconfigure(on ? smartPunctuation() : []) })
}

/** CSS counters number the headings; the document text stays untouched. */
export function setHeadingNumbers(view: EditorView, on: boolean) {
  view.dom.classList.toggle('nib-numbered', on)
}

/** Numbers the lines inside code fences, counting from one per fence. */
export function setCodeLineNumbers(view: EditorView, on: boolean) {
  view.dom.classList.toggle('nib-line-numbers', on)
}

/** Widens or narrows the writing column. */
export function setMeasure(view: EditorView, rem: number) {
  view.dom.style.setProperty('--measure', `${rem}rem`)
  remeasure(view)
}

/** Line height for the writing surface. */
export function setLineHeight(view: EditorView, height: number) {
  view.dom.style.setProperty('--leading-content', String(height))
  remeasure(view)
}

/** Tells the editor its text has changed shape.
 *
 *  Every one of these settings works by writing a CSS custom property, and a
 *  custom property is invisible to CodeMirror: it caches the line height and
 *  character width it measured once and goes on trusting them. The cached
 *  numbers are what place the caret and decide which line a click lands on, so
 *  a stale one puts every position slightly out - and the error adds up with
 *  every line down the document. */
export function remeasure(view: EditorView) {
  // A view torn down between the change and this call has nothing to measure.
  if (view.dom.isConnected) view.requestMeasure()
}

/** Right-to-left writing, for Arabic and Hebrew. */
/** The browser's own spell checker, over the writing surface. `language` is
 *  the dictionary to check against, as a language tag; the browser reads it
 *  off the surface's `lang`. Without one it falls back to its own choice. */
export function setSpellcheck(view: EditorView, on: boolean, language?: string) {
  view.dispatch({
    effects: spelling.reconfigure(
      EditorView.contentAttributes.of({
        spellcheck: on ? 'true' : 'false',
        ...(language ? { lang: language } : {}),
      }),
    ),
  })
}

export function setCloseBrackets(view: EditorView, on: boolean) {
  view.dispatch({ effects: brackets.reconfigure(on ? closeBrackets() : []) })
}

export function setRightToLeft(view: EditorView, on: boolean) {
  view.contentDOM.setAttribute('dir', on ? 'rtl' : 'ltr')
  view.dom.classList.toggle('nib-rtl', on)
}
