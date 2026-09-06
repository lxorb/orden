import { history } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'
import { EditorState, Prec, type Text } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
} from '@codemirror/view'
import { editorCompletion } from './emoji'
import { external } from './external'
import { imageHandling, imageResolver, type ImageSink } from './images'
import { linkClicks, linkOpener } from './links'
import { wikilinks } from './wikilink'
import { blockNamer } from './wikilink/complete'
import { type NoteIndex, noteIndexExtension, type NoteJump, noteOpener } from './wikilink/notes'
import { codeThemeExtension } from './code-theme'
import { closeFence } from './commands'
import { nibBindings, standardBindings, unclaimedKeymap } from './keymap'
import { richPaste } from './paste'
import { modeExtensions } from './modes'
import { boundKeymap, type KeyOverrides, shortcutExtensions } from './shortcuts'
import { tableBindings } from './table/keymap'
import { nibHighlightStyle, nibTheme } from './theme'

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
  /** Keys the reader chose, as differences from the defaults. Changed later
   *  through `setShortcutKeys`; this is only what the editor opens with. */
  shortcuts?: KeyOverrides
  /** The space around this note: which notes exist and what they say, so
   *  `[[wikilinks]]` can be drawn, completed, followed and previewed. Set later
   *  through `setNoteIndex`; this is only what the editor opens with. */
  notes?: NoteIndex
  /** Follows a link between notes: opens it, or makes it when there is none. */
  openNote?: (jump: NoteJump) => void
  /** Names a block of another note, so a link can point at the block. */
  nameBlock?: (path: string, line: number) => Promise<string | null>
}

export function createEditor(options: EditorOptions): EditorView {
  const { parent, doc = '', onChange, onImage, resolveImage, onSelection } = options
  const { openLink, openNote, nameBlock } = options
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
        // Links between notes: drawn, followed, completed and previewed. What
        // notes there are comes from the app; see wikilink/index.ts.
        wikilinks(),
        noteIndexExtension(options.notes),
        ...(openNote ? [noteOpener.of(openNote)] : []),
        ...(nameBlock ? [blockNamer.of(nameBlock)] : []),
        nibTheme,
        // Above the markdown language's own Enter, which continues a list or
        // a quote and would otherwise take the key on a fence inside one.
        Prec.highest(keymap.of([{ key: 'Enter', run: closeFence }])),
        // Which key runs what, in one place and changeable while the editor
        // is open: see shortcuts.ts.
        shortcutExtensions(options.shortcuts),
        boundKeymap([
          // Arrow keys beside a table walk into it; the defaults would step
          // over it. These give way whenever no table is in the way.
          ...tableBindings,
          // Markdown bindings come first so they win over the defaults.
          ...nibBindings,
          ...standardBindings,
        ]),
        // What the library binds that nothing here has a name for, underneath
        // everything that does.
        keymap.of(unclaimedKeymap),
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
