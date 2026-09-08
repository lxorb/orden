import { Compartment, EditorState, type Extension, Prec, type StateEffect } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import {
  commonmarkLanguage,
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
  markdown,
  markdownLanguage,
} from '@codemirror/lang-markdown'
import { isExternal } from './external'
import { fenceLanguages } from './languages'
import { livePreview } from './live-preview'
import { noReveal } from './live-preview/reveal'
import { numberEquations } from './live-preview/blocks'
import { nibMarkdownExtensions } from './markdown/extensions'
import { closeBrackets } from '@codemirror/autocomplete'
import { flushTableEdits } from './table/widget'
import { smartPunctuation } from './typography'
import { codeThemeEffect } from './code-theme'
import { ligatures, type LigatureScope } from './ligatures'
import { once } from './once'
import { leaveQuote } from './commands'
import { wrapSelection } from './wrap'
import { vimEffect, vimExtensions } from './vim'

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
const glyphs = new Compartment()
const readOnly = new Compartment()
const headingNumbers = new Compartment()
const codeLineNumbers = new Compartment()
const direction = new Compartment()
const deck = new Compartment()

/** A class the stylesheet works from, handed to the editor rather than put on
 *  its element. CodeMirror writes that element's class attribute out from its
 *  own facets every time the editor takes or loses focus, so a class added
 *  with `classList` survives only until the next click somewhere else - the
 *  mode was still on while everything that made it visible was gone. Attributes
 *  from this facet are merged into what CodeMirror writes, and they leave again
 *  when the compartment holding them is emptied. */
function editorClass(name: string): Extension {
  return EditorView.editorAttributes.of({ class: name })
}

/** The two keys `markdown()` binds for itself, bound here instead so that Enter
 *  can be told how a list ends.
 *
 *  A writer says a list is over by pressing Enter on the empty item, and that
 *  press ends it in Typora, in Obsidian and in GitHub's own editor. CodeMirror's
 *  default spends that press turning a tight list into a loose one - a blank
 *  line pushed in above the marker - and only ends the list on the press after
 *  that, leaving a stray line and a bullet to be deleted by hand. `nonTightLists`
 *  is what that behaviour is called, and false is the habit this editor follows.
 *
 *  At `Prec.high`, which is exactly where `markdown()` puts them, so nothing
 *  else changes about which key reaches what. */
const markdownKeys = Prec.high(
  keymap.of([
    // Ahead of the markup command, which ends a quote only after a second empty
    // quoted line. It gives the key back unless the line is marks and nothing
    // else, so everything else about Enter is the command below.
    { key: 'Enter', run: leaveQuote },
    { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
    { key: 'Backspace', run: deleteMarkupBackward },
  ]),
)

/** Strict mode drops GFM and the Typora extensions, leaving plain CommonMark -
 *  useful when a document has to render the same everywhere. */
export const markdownFor = once((strict: boolean): Extension => [
  markdown({
    base: strict ? commonmarkLanguage : markdownLanguage,
    codeLanguages: fenceLanguages,
    extensions: strict ? [] : nibMarkdownExtensions,
    addKeymap: false,
  }),
  markdownKeys,
])

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
        for (let pos = from; pos <= to;) {
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

/** A fresh editor's modes: the defaults, said through the same builders the
 *  effects below use, so a view the app dresses the moment it is built is handed
 *  the values it already holds rather than equal ones built again. See once.ts.
 */
export function modeExtensions(): Extension {
  return [
    language.of(markdownFor(false)),
    preview.of(previewFor(false)),
    focus.of(focusFor(false)),
    typewriter.of(typewriterFor(false)),
    punctuation.of(punctuationFor(true)),
    equations.of(numberEquations.of(false)),
    // Off until asked for: a checker's wavy lines under prose that is not in
    // its dictionary's language are noise, and most notes start that way.
    spelling.of(spellingFor(false)),
    brackets.of(bracketsFor(true)),
    // Off until asked for: a note reads as typed unless someone chose otherwise.
    glyphs.of(ligaturesFor('off')),
    readOnly.of(readOnlyFor(false)),
    headingNumbers.of(headingNumbersFor(false)),
    codeLineNumbers.of(codeLineNumbersFor(false)),
    direction.of(directionFor(false)),
    // Whether this note is a deck. Not one of the modes: it is a fact about the
    // note in the editor rather than a choice anybody made, so the app tells
    // each view about its own note; see setDeck.
    deck.of(deckFor(false)),
    // Off until asked for. Its compartment lives with the rest of it in
    // vim.ts, which is a mode with a keymap of its own to answer for.
    vimExtensions(),
  ]
}

/** What read-only mode puts over the editor while it is on.
 *
 *  Three locks, because a document can be written to through three different
 *  doors. `editable` takes the contenteditable off the writing surface, so the
 *  browser stops offering it as somewhere to type and stops drawing a caret in
 *  it. `readOnly` is what CodeMirror's own handlers and every command in
 *  @codemirror/commands ask before they write - it is how Backspace, Enter and
 *  undo come to refuse. And the change filter has the last word: a widget - a
 *  checkbox, a cell of a rendered table, the language on a fence - dispatches
 *  its change straight at the view and asks nobody's permission. Only a change
 *  from outside the editor gets through, so a note being loaded, a version
 *  restored or a sync arriving still lands under the reader's eyes. */
function readOnlyExtensions(): Extension {
  return [
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    // Nothing reveals: see live-preview/reveal.ts.
    noReveal.of(true),
    // A surface that is not editable is not focusable either, and a page
    // nothing can focus cannot be scrolled, searched or selected from the
    // keyboard. So it keeps its place in the tab order; the caret that would
    // otherwise blink in it is taken away in the stylesheet.
    EditorView.contentAttributes.of({ tabindex: '0' }),
    // The class the stylesheet works from. Handed to the editor rather than
    // put on its element, because CodeMirror writes that element's class
    // attribute out from its own facets every time the editor takes or loses
    // focus - a class added from outside survives only until the next click
    // somewhere else. Attributes from this facet are merged into what it
    // writes, so this one is part of the configuration and goes when the
    // compartment is emptied.
    EditorView.editorAttributes.of({ class: 'nib-read-only' }),
    EditorState.changeFilter.of(isExternal),
  ]
}

/* What each mode is while it is on, said once. The setter that toggles one and
   the batch that configures a whole editor for all of them both read from here,
   so the two cannot drift into meaning different things. */

const readOnlyFor = once((on: boolean): Extension => (on ? readOnlyExtensions() : []))

/** Source mode shows the markdown as written, so nothing is drawn over it. */
const previewFor = once((source: boolean): Extension => (source ? [] : livePreview()))

const focusFor = once((on: boolean): Extension =>
  on ? [focusPlugin, editorClass('nib-focus-mode')] : [],
)

/** The class buys extra room below the last line, so the caret can still reach
 *  the middle. */
const typewriterFor = once((on: boolean): Extension =>
  on ? [typewriterPlugin, editorClass('nib-typewriter-mode')] : [],
)

/** Shows `->`, `<=` and their kind as the arrow or sign they stand for; the text
 *  underneath stays as typed. The class lets the stylesheet hold back the code
 *  font's own ligatures wherever this scope draws none, so that off means off:
 *  it is on for both scopes that draw in code, which is both of them. */
const ligaturesFor = once((scope: LigatureScope): Extension =>
  scope === 'off' ? [] : [ligatures(scope), editorClass('nib-ligatures')],
)

/** Curly quotes, dashes, ellipsis - on by default, like Typora. */
const punctuationFor = once((on: boolean): Extension => (on ? smartPunctuation() : []))

/** CSS counters number the headings; the document text stays untouched. */
const headingNumbersFor = once((on: boolean): Extension => (on ? editorClass('nib-numbered') : []))

/** Numbers the lines inside code fences, counting from one per fence. */
const codeLineNumbersFor = once((on: boolean): Extension =>
  on ? editorClass('nib-line-numbers') : [],
)

/** Brackets and quotes close themselves, and a mark typed over a selection goes
 *  around it. One switch, because both are the same promise: what you type
 *  lands around what you meant rather than over it. */
const bracketsFor = once((on: boolean): Extension => (on ? [closeBrackets(), wrapSelection()] : []))

/** A note whose rules break it into slides. Only a class, because that is all
 *  the difference is: the rules are already decorated, and the stylesheet shows
 *  which of them are slide breaks while this is on. See
 *  packages/markdown/src/slides.ts for what makes a note a deck. */
const deckFor = once((on: boolean): Extension => (on ? editorClass('nib-deck') : []))

/** The writing direction, given to the editor the same way as the class: the
 *  content element's attributes are CodeMirror's to write too. */
const directionFor = once((rtl: boolean): Extension =>
  rtl
    ? [EditorView.contentAttributes.of({ dir: 'rtl' }), editorClass('nib-rtl')]
    : EditorView.contentAttributes.of({ dir: 'ltr' }),
)

/** The browser's own spell checker, over the writing surface. `language` is the
 *  dictionary to check against, as a language tag; the browser reads it off the
 *  surface's `lang`. Without one it falls back to its own choice.
 *
 *  Two settings in one extension, so what is built once is keyed on the pair of
 *  them written out as one string; see once.ts. */
const spellings = once((setting: string): Extension => {
  const language = setting.slice(setting.indexOf('|') + 1)
  return EditorView.contentAttributes.of({
    spellcheck: setting.startsWith('on|') ? 'true' : 'false',
    ...(language ? { lang: language } : {}),
  })
})

const spellingFor = (on: boolean, language?: string): Extension =>
  spellings(`${on ? 'on' : 'off'}|${language ?? ''}`)

/** Every mode there is, as the app holds them; see modes.svelte.ts. */
export interface ModeSettings {
  source: boolean
  readOnly: boolean
  focus: boolean
  typewriter: boolean
  punctuation: boolean
  numbers: boolean
  lineNumbers: boolean
  codeTheme: string
  rtl: boolean
  strict: boolean
  equationNumbers: boolean
  spellcheck: boolean
  /** Which dictionary to check against. Absent leaves the choice to the
   *  browser. */
  dictionary?: string | undefined
  closeBrackets: boolean
  /** How much of a note the ligature glyphs are drawn over. */
  ligatures: LigatureScope
  vim: boolean
}

/** Every mode at once, as the effects that put an editor into them.
 *
 *  One transaction rather than seventeen. A pane taking another note on swaps in
 *  a state built for whatever the modes were at the time, and this is what
 *  brings it up to what they are now - in the same transaction as the caret and
 *  the scroll, so the note appears already in its modes instead of settling into
 *  them over the frames after it. */
export function modeEffects(settings: ModeSettings): StateEffect<unknown>[] {
  // A cell may be holding an edit that has not reached the document yet, and
  // what goes on below can take the table, the keyboard, or the right to write
  // at all, out from under it.
  flushTableEdits()

  return [
    language.reconfigure(markdownFor(settings.strict)),
    preview.reconfigure(previewFor(settings.source)),
    // Source mode and read-only are opposite answers to the same question, and
    // the markdown as written is the writer's answer; see setReadOnlyMode.
    readOnly.reconfigure(readOnlyFor(settings.readOnly && !settings.source)),
    focus.reconfigure(focusFor(settings.focus)),
    typewriter.reconfigure(typewriterFor(settings.typewriter)),
    punctuation.reconfigure(punctuationFor(settings.punctuation)),
    equations.reconfigure(numberEquations.of(settings.equationNumbers)),
    spelling.reconfigure(spellingFor(settings.spellcheck, settings.dictionary)),
    brackets.reconfigure(bracketsFor(settings.closeBrackets)),
    glyphs.reconfigure(ligaturesFor(settings.ligatures)),
    headingNumbers.reconfigure(headingNumbersFor(settings.numbers)),
    codeLineNumbers.reconfigure(codeLineNumbersFor(settings.lineNumbers)),
    direction.reconfigure(directionFor(settings.rtl)),
    codeThemeEffect(settings.codeTheme),
    vimEffect(settings.vim),
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
  // Turning it on unlocks a note that was read-only: the two are opposite
  // answers to the same question, and the markdown as written is the writer's
  // answer. See setReadOnlyMode below.
  view.dispatch({
    effects: on
      ? [preview.reconfigure(previewFor(true)), readOnly.reconfigure(readOnlyFor(false))]
      : preview.reconfigure(previewFor(false)),
  })
}

/** Read-only mode: the note laid out as it reads, with nothing that writes to
 *  it. The app's reading view is a different thing - the note through the
 *  renderer, in Reading.svelte - and this is the editor with the doors locked.
 *
 *  Source mode is its opposite, so the two are never both on: turning either one
 *  on turns the other off. Locking raw markdown is a contradiction, since source
 *  mode is for seeing what you are about to type. */
export function setReadOnlyMode(view: EditorView, on: boolean) {
  // A cell may be holding an edit that has not reached the document yet, and
  // once this is on nothing can put it there.
  flushTableEdits()
  view.dispatch({
    effects: on
      ? [readOnly.reconfigure(readOnlyFor(true)), preview.reconfigure(previewFor(false))]
      : readOnly.reconfigure(readOnlyFor(false)),
  })
}

export function setFocusMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: focus.reconfigure(focusFor(on)) })
}

export function setTypewriterMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: typewriter.reconfigure(typewriterFor(on)) })
}

export function setLigatures(view: EditorView, scope: LigatureScope) {
  view.dispatch({ effects: glyphs.reconfigure(ligaturesFor(scope)) })
}

export function setSmartPunctuation(view: EditorView, on: boolean) {
  view.dispatch({ effects: punctuation.reconfigure(punctuationFor(on)) })
}

export function setHeadingNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: headingNumbers.reconfigure(headingNumbersFor(on)) })
}

export function setCodeLineNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: codeLineNumbers.reconfigure(codeLineNumbersFor(on)) })
}

/** Whether the note in this view is a deck, which marks the rules that break it
 *  into slides. Per view rather than per app: two panes may hold two notes and
 *  only one of them be a deck. */
export function setDeck(view: EditorView, on: boolean) {
  view.dispatch({ effects: deck.reconfigure(deckFor(on)) })
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

export function setSpellcheck(view: EditorView, on: boolean, language?: string) {
  view.dispatch({ effects: spelling.reconfigure(spellingFor(on, language)) })
}

export function setCloseBrackets(view: EditorView, on: boolean) {
  view.dispatch({ effects: brackets.reconfigure(bracketsFor(on)) })
}

export function setRightToLeft(view: EditorView, on: boolean) {
  view.dispatch({ effects: direction.reconfigure(directionFor(on)) })
}
