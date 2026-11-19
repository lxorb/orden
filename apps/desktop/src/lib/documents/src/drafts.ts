import {
  endingOf,
  nameFromContent,
  nameFromTitle,
  shownName,
  TITLE_CHARS,
  isMarkdownPath,
} from '../../platform/src/api'
import { isOnlineTab } from '../../online-terms/src/api'
import { holdsWords, type NoteDoc, type TabKind, UNTITLED } from './documents.svelte'
import { TAB_KINDS } from '../../tab-kinds/src/api'

export const isDraft = (note: NoteDoc): boolean => note.path === null && note.shared === null && holdsWords(note.kind)

export function isUnsaved(note: NoteDoc): boolean {
  if (isDraft(note)) return true
  if (note.path !== null || note.shared !== null) return false
  return note.kind === 'web' || isOnlineTab({ kind: note.kind, path: null, doc: note.text })
}

export const hasWords = (note: NoteDoc): boolean => (note.kind === 'note' ? !note.blank : note.dirty)

export function fileNamed(name: string, kind: TabKind): string {
  const extension = TAB_KINDS[kind].extension
  if (extension === null) return name

  const already = kind === 'note' ? isMarkdownPath(name) : endingOf(name)?.toLowerCase() === extension
  return already ? name : `${name}${extension}`
}

export const namedByWords = (note: NoteDoc): boolean => note.kind === 'note' && note.name === UNTITLED

export function offeredName(note: NoteDoc, title?: string): string {
  if (note.kind === 'web') return nameFromTitle(title?.trim() ? title : note.name) ?? UNTITLED
  if (!namedByWords(note)) return shownName(note.name)

  return nameFromContent(note.live.text.sliceString(0, TITLE_CHARS)) ?? UNTITLED
}

export const draftFile = (note: NoteDoc): string => fileNamed(offeredName(note), note.kind)
