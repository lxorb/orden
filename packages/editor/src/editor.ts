import { history } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { EditorState, type Extension, Prec, type Text } from '@codemirror/state'
import {
  crosshairCursor,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  type PluginValue,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { remoteCarets } from './carets'
import { completionExtensions } from './completion'
import { external } from './external'
import { blockHandles } from './block/handle'
import { landing } from './landing'
import { folding, foldsChanged, type FoldLines, withFolds } from './fold'
import { imageHandling, imageResolver, type ImageSink } from './images'
import { propertyChoices } from './live-preview/properties'
import { linkClicks, type LinkPress, linkOpener } from './links'
import { tagClicks, tagOpener, type TagOpener } from './tag-press'
import { trustedMarkup } from './markup'
import { wikilinks } from './wikilink'
import { blockNamer } from './wikilink/block-namer'
import { noteCarrier, noteDrops } from './wikilink/drop'
import { type PreviewMount, previewEditor } from './wikilink/hover'
import {
  type LinkWrite,
  linkWriter,
  type NoteIndex,
  noteIndexExtension,
  noteOpener,
  type NoteOpener,
} from './wikilink/notes'
import { codeThemeExtension } from './code-theme'
import { type FindAsk, findExtensions } from './find'
import { closeFence, leaveQuote } from './commands'
import { refuseControlCharacters } from './control'
import { nibBindings, standardBindings, unclaimedKeymap } from './keymap'
import { richCopy } from './copy'
import { richPaste } from './paste'
import { nibSelection } from './selection/layer'
import { steppingKeymap } from './live-preview/stepping'
import { openTail, openTailDown } from './tail'
import { modeExtensions } from './modes'
import { parseAhead } from './parse-ahead'
import { documentOf, fromInput, type SharedDoc, sharing } from './shared'
import { boundKeymap, type KeyOverrides, shortcutExtensions } from './shortcuts'
import { tableBindings } from './table/keymap'
import { nibHighlightStyle, nibTheme } from './theme'

export interface StateOptions {
  doc?: string
  selection?: { anchor: number; head?: number }
  shared?: SharedDoc
  onChange?: (doc: Text) => void
  onImage?: ImageSink
  resolveImage?: (src: string) => string
  propertyChoices?: Record<string, readonly string[]>
  onSelection?: (view: EditorView) => void
  codeTheme?: string
  openLink?: (href: string, press: LinkPress) => void
  shortcuts?: KeyOverrides
  notes?: NoteIndex
  openNote?: NoteOpener
  openTag?: TagOpener
  nameBlock?: (path: string, line: number) => Promise<string | null>
  writeLink?: (target: LinkWrite) => string
  carriedNotes?: (transfer: DataTransfer | null) => readonly string[]
  folds?: readonly FoldLines[]
  onFind?: (ask: FindAsk | null) => void
  trustedMarkup?: boolean
  editPreview?: PreviewMount
  coveredBelow?: () => number
}

export interface EditorOptions extends StateOptions {
  parent: HTMLElement
}

const carried: Extension[] = []

export function carryIntoEditors(extension: Extension): void {
  if (!carried.includes(extension)) carried.push(extension)
}

export function editorState(options: StateOptions): EditorState {
  const { doc = '', onChange, onImage, resolveImage, onSelection } = options
  const { openLink, openNote, nameBlock, writeLink, shared, selection, folds } = options
  const { editPreview, carriedNotes } = options
  const text = shared ? shared.text : doc

  const state = EditorState.create({
    doc: text,
    ...(selection
      ? { selection: { anchor: Math.min(Math.max(0, selection.anchor), text.length) } }
      : {}),
    extensions: [
      history(),
      Prec.high(
        EditorView.domEventHandlers({
          beforeinput(event, view) {
            const command = fromInput(event.inputType)
            if (!command) return false
            event.preventDefault()
            return command(view)
          },
        }),
      ),
      refuseControlCharacters(),
      sharing(),
      folding(),
      blockHandles(),
      landing(),
      remoteCarets(),
      ...carried,
      nibSelection(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.clickAddsSelectionRange.of((event) => event.altKey && !event.shiftKey),
      rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey }),
      crosshairCursor(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      findExtensions(options.onFind),
      EditorView.lineWrapping,
      ...(options.coveredBelow ? [coveredBelow(options.coveredBelow)] : []),
      EditorView.contentAttributes.of({ class: 'nib-write' }),
      syntaxHighlighting(nibHighlightStyle),
      codeThemeExtension(options.codeTheme),
      modeExtensions(text.length),
      mathsPreview,
      parseAhead,
      completionExtensions(),
      ...(onImage ? [imageHandling(onImage)] : []),
      richPaste(),
      richCopy(),
      openTail(),
      ...(resolveImage ? [imageResolver.of(resolveImage)] : []),
      ...(options.propertyChoices ? [propertyChoices.of(options.propertyChoices)] : []),
      linkClicks,
      ...(openLink ? [linkOpener.of(openLink)] : []),
      wikilinks(),
      noteIndexExtension(options.notes),
      trustedMarkup(options.trustedMarkup),
      ...(openNote ? [noteOpener.of(openNote)] : []),
      tagClicks,
      ...(options.openTag ? [tagOpener.of(options.openTag)] : []),
      ...(nameBlock ? [blockNamer.of(nameBlock)] : []),
      ...(writeLink ? [linkWriter.of(writeLink)] : []),
      noteDrops,
      ...(carriedNotes ? [noteCarrier.of(carriedNotes)] : []),
      ...(editPreview ? [previewEditor.of(editPreview)] : []),
      nibTheme,
      Prec.highest(keymap.of([{ key: 'Enter', run: closeFence }])),
      Prec.high(
        keymap.of([
          { key: 'Enter', run: leaveQuote },
          { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
          { key: 'Backspace', run: deleteMarkupBackward },
        ]),
      ),
      shortcutExtensions(options.shortcuts),
      boundKeymap([...tableBindings, ...nibBindings, ...standardBindings]),
      keymap.of([{ key: 'ArrowDown', run: openTailDown }]),
      keymap.of(steppingKeymap),
      keymap.of(unclaimedKeymap),
      EditorView.updateListener.of((update) => {
        const pushed = update.transactions.some((one) => one.annotation(external))
        if (update.docChanged && !pushed) {
          const document = documentOf(update.view)
          if (document) document.local(update.changes, update.state.selection, update.view)
          else onChange?.(update.state.doc)
        }
        if (
          update.selectionSet ||
          update.docChanged ||
          update.focusChanged ||
          foldsChanged(update)
        ) {
          onSelection?.(update.view)
        }
      }),
    ],
  })

  return withFolds(state, folds ?? [])
}

function hasDollar(text: Text): boolean {
  for (const iter = text.iter(); !iter.next().done;) if (iter.value.includes('$')) return true
  return false
}

const mathsPreview = ViewPlugin.fromClass(
  class {
    private inner: (PluginValue & { update(update: ViewUpdate): void }) | null = null
    private asked = false
    private gone = false

    constructor(view: EditorView) {
      if (hasDollar(view.state.doc)) this.open(view)
    }

    update(update: ViewUpdate) {
      if (this.inner) {
        this.inner.update(update)
        return
      }
      update.changes.iterChanges((_a, _b, _c, _d, inserted) => {
        if (hasDollar(inserted)) this.open(update.view)
      })
    }

    private open(view: EditorView) {
      if (this.asked) return
      this.asked = true
      void import('./maths-preview').then(({ openPreview }) => {
        if (!this.gone) this.inner = openPreview(view)
      })
    }

    destroy() {
      this.gone = true
      this.inner?.destroy?.()
    }
  },
)

function coveredBelow(covered: () => number) {
  return EditorView.scrollMargins.of(() => ({ bottom: covered() }))
}

export function createEditor(options: EditorOptions): EditorView {
  const view = new EditorView({ parent: options.parent, state: editorState(options) })

  options.shared?.join(view)
  return view
}
