import { closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Annotation, EditorState, Prec, type Text } from '@codemirror/state'
import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap } from '@codemirror/view'
import { editorCompletion } from './emoji'
import { imageHandling, imageResolver, type ImageSink } from './images'
import { linkClicks, linkOpener } from './links'
import { codeThemeExtension } from './code-theme'
import { closeFence } from './commands'
import { nibKeymap } from './keymap'
import { richPaste } from './paste'
import { modeExtensions } from './modes'
import { tableKeymap } from './table/keymap'
import { nibHighlightStyle, nibTheme } from './theme'

/** Marks a change as content put into the view from outside - a note being
 *  loaded, a version restored - rather than something anyone typed. */
const external = Annotation.define<boolean>()

/** Puts a whole document into a view without it being read back as an edit.
 *  The alternative, comparing what came in against what is already there, is
 *  a pass over the whole note, and the reason a large one felt heavy to type
 *  in: every keystroke changed the text the surrounding app held, and the app
 *  handed it straight back. */
export function replaceDoc(view: EditorView, doc: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: doc },
    annotations: external.of(true),
  })
}

export interface EditorOptions {
  parent: HTMLElement
  doc?: string
  /** Called with the editor's own text - CodeMirror's rope, not a string, so
   *  turning it into one is the caller's decision and can wait. */
  onChange?: (doc: Text) => void
  /** Called when an image is pasted or dropped; returns the path to insert. */
  onImage?: ImageSink
  /** Maps a document-relative image path to a URL the view can load. */
  resolveImage?: (src: string) => string
  /** Fires when the selection moves, so a toolbar can follow it. */
  onSelection?: (view: EditorView) => void
  /** Which palette colours code fences. Defaults to following the app theme. */
  codeTheme?: string
  /** Follows a link the reader modifier-clicked. Defaults to a browser tab. */
  openLink?: (href: string) => void
}

export function createEditor(options: EditorOptions): EditorView {
  const { parent, doc = '', onChange, onImage, resolveImage, onSelection, openLink } = options
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        // The writing surface carries Typora's `#write` id, so Typora themes
        // that target `#write` style our editor directly.
        EditorView.contentAttributes.of({ id: 'write' }),
        syntaxHighlighting(nibHighlightStyle),
        codeThemeExtension(options.codeTheme),
        modeExtensions(),
        editorCompletion(),
        // Images are checked first, so a screenshot beats the HTML around it.
        ...(onImage ? [imageHandling(onImage)] : []),
        richPaste(),
        ...(resolveImage ? [imageResolver.of(resolveImage)] : []),
        linkClicks,
        ...(openLink ? [linkOpener.of(openLink)] : []),
        nibTheme,
        // Above the markdown language's own Enter, which continues a list or
        // a quote and would otherwise take the key on a fence inside one.
        Prec.highest(keymap.of([{ key: 'Enter', run: closeFence }])),
        keymap.of([
          // Arrow keys beside a table walk into it; the defaults would step
          // over it. These give way whenever no table is in the way.
          ...tableKeymap,
          // Markdown bindings come first so they win over the defaults.
          ...nibKeymap,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          // Text this view was handed is not news to whoever handed it over.
          const pushed = update.transactions.some((one) => one.annotation(external))
          if (update.docChanged && !pushed) onChange?.(update.state.doc)
          if (update.selectionSet || update.docChanged || update.focusChanged) {
            onSelection?.(update.view)
          }
        }),
      ],
    }),
  })
}
