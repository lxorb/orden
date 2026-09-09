export { createEditor, type EditorOptions, editorState, type StateOptions } from './editor'
export { HeldState, type StateView } from './held'
export { type Peer, peersOf, remoteCarets, setPeers } from './carets'
export { redoEdit, SharedDoc, sharedOf, undoEdit } from './shared'
export {
  clearFormatting,
  insertCallout,
  insertCodeFence,
  insertComment,
  insertFootnote,
  insertFrontMatter,
  insertLink,
  insertHorizontalRule,
  insertMathBlock,
  insertPageBreak,
  insertSlideBreak,
  insertTable,
  insertToc,
  setHeading,
  shiftHeading,
  toggleBulletList,
  toggleOrderedList,
  toggleQuote,
  toggleTask,
  toggleTaskList,
  toggleWrap,
} from './commands'
export { findNext, findPrevious, openFind, openReplace } from './find'
export {
  foldHeadings,
  type FoldLines,
  foldLines,
  sameFolds,
  toggleFold,
  unfoldEverything,
} from './fold'
export { pasteHere, pastePlain } from './paste'
export { reformat, reformatDocument } from './reformat'
export { CODE_PALETTES, type CodePalette, setCodeTheme } from './code-theme'
export { DIAGRAM_LANGUAGES, diagramSvg } from './live-preview/render'
export { fenceLanguages } from './languages'
export { sequenceToMermaid } from './live-preview/sequence'
export { nibHighlightStyle, nibTheme } from './theme'
export { livePreview } from './live-preview'
export { selectedImage } from './live-preview/image'
export { imageResolver, type ImageSink } from './images'
export { hrefOf, linkOpener } from './links'
export {
  type NoteIndex,
  type NoteJump,
  type NoteRef,
  resolveFile,
  resolveNote,
  resolveRelative,
  noteIndexEffect,
  setNoteIndex,
} from './wikilink/notes'
export { setSnippets, snippets } from './snippets'
export { englishLabel, LABEL_KEYS, type LabelKey, setLabels } from './labels'
export {
  setCloseBrackets,
  setCodeLineNumbers,
  setDeck,
  setEquationNumbers,
  setFocusMode,
  setHeadingNumbers,
  modeEffects,
  type ModeSettings,
  setLigatures,
  setLineHeight,
  setMeasure,
  remeasure,
  setReadOnlyMode,
  setRightToLeft,
  setSmartPunctuation,
  setSourceMode,
  setSpellcheck,
  setStrictMode,
  setTypewriterMode,
} from './modes'
export { findLigatures, type Ligature, LIGATURES, type LigatureScope } from './ligatures'
export { onVimMode, setVim, setVimCommands, type VimCommands, type VimMode } from './vim'
export { flushTableEdits } from './table/widget'
export { insertTableToEdit, tableBindings } from './table/keymap'
export { imageBindings } from './live-preview/image'
export { nibBindings, nibKeymap, standardBindings, unclaimedKeymap } from './keymap'
export {
  type BindingSpec,
  bindings,
  defaultKeyFor,
  type KeyOverrides,
  setShortcutKeys,
  shortcutEffect,
} from './shortcuts'
export { caretLine, showLine, topLine } from './scroll'
export { EditorView } from '@codemirror/view'
export { EditorState, StateEffect } from '@codemirror/state'
export type { ChangeSet, StateCommand, Text, Transaction, TransactionSpec } from '@codemirror/state'
