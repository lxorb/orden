import { endingOf, nameFromContent, nameFromTitle, shownName, TITLE_CHARS } from '../note-name'
import { isOnlineTab } from '../online/path'
import { isMarkdownPath } from '../space-paths'
import { holdsWords, type NoteDoc, type TabKind, UNTITLED } from './documents.svelte'
import { TAB_KINDS } from './tab-kinds'

export function isDraft(note: NoteDoc): boolean {
  return note.path === null && note.shared === null && holdsWords(note.kind)
}

export function isUnsaved(note: NoteDoc): boolean {
  if (isDraft(note)) return true
  if (note.path !== null || note.shared !== null) return false
  return note.kind === 'web' || isOnlineTab({ kind: note.kind, path: null, doc: note.text })
}

export function hasWords(note: NoteDoc): boolean {
  return note.kind === 'note' ? !note.blank : note.dirty
}

export function worthAFile(note: NoteDoc): boolean {
  if (!hasWords(note)) return false
  if (note.kind !== 'note') return true

  return (
    note.live.text
      .sliceString(0, 4096)
      .replace(/^[ \t]*(?:>[ \t]?)*(?:#{1,6}|[-*+]|\d+[.)])?(?:[ \t]+\[[ xX]\])?[ \t]*/gmu, '')
      .replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, '') !== ''
  )
}

export function fileNamed(name: string, kind: TabKind): string {
  const extension = TAB_KINDS[kind].extension
  if (extension === null) return name

  const already =
    kind === 'note' ? isMarkdownPath(name) : endingOf(name)?.toLowerCase() === extension
  return already ? name : `${name}${extension}`
}

export function namedByWords(note: NoteDoc): boolean {
  return note.kind === 'note' && note.name === UNTITLED
}

export function offeredName(note: NoteDoc, title?: string): string {
  if (note.kind === 'web') return nameFromTitle(title?.trim() ? title : note.name) ?? UNTITLED
  if (!namedByWords(note)) return shownName(note.name)

  return nameFromContent(note.live.text.sliceString(0, TITLE_CHARS)) ?? UNTITLED
}

export function draftFile(note: NoteDoc): string {
  return fileNamed(offeredName(note), note.kind)
}
