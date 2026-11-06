import { HighlightStyle } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { markTags } from './markdown/tags'

export const nibTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontFamily: 'var(--font-content)',
    fontSize: 'var(--text-content)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'var(--leading-content)',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
    borderLeftWidth: '2px',
  },
  '.cm-content ::selection, .cm-content::selection': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--accent-soft)',
    borderRadius: '3px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--accent-soft)',
    outline: '1px solid var(--accent-line)',
    borderRadius: '3px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-ink)',
  },
})

export const nibHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '620' },
  { tag: tags.heading2, fontWeight: '620' },
  { tag: tags.heading3, fontWeight: '620' },
  { tag: tags.heading4, fontWeight: '620' },
  { tag: tags.heading5, fontWeight: '620' },
  { tag: tags.heading6, fontWeight: '620', color: 'var(--muted-strong)' },
  { tag: tags.strong, fontWeight: '650', color: 'var(--text-strong)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--muted)' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
  { tag: tags.quote, color: 'var(--muted-strong)' },
  { tag: tags.list, color: 'var(--text)' },
  { tag: tags.contentSeparator, color: 'var(--muted)' },
  { tag: tags.meta, color: 'var(--md-char-color)' },
  { tag: tags.processingInstruction, color: 'var(--md-char-color)' },
  { tag: markTags.highlight, background: 'var(--accent-soft)', color: 'var(--text-strong)' },
  { tag: markTags.math, fontFamily: 'var(--font-mono)', color: 'var(--muted-strong)' },
  { tag: markTags.footnote, color: 'var(--accent)', fontSize: '0.8em', verticalAlign: 'super' },
  { tag: markTags.frontMatter, fontFamily: 'var(--font-mono)', color: 'var(--muted)' },
  { tag: markTags.hashtag, color: 'var(--tag)' },
])
