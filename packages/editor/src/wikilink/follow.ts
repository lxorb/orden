import type { EditorState } from '@codemirror/state'
import { type Command, EditorView } from '@codemirror/view'
import { isTabFile, linkTarget, type Wikilink } from '@orden/markdown/links'
import { label } from '../labels'
import { type LinkPress, MAC, modifier } from '../links'
import { linkAt } from './at'
import { jumpFor, noteIndex, type NoteJump, noteOpener } from './notes'

const HOW = {
  open: { mac: 'openNoteMac', other: 'openNote' },
  create: { mac: 'createNoteMac', other: 'createNote' },
  file: { mac: 'openLinkMac', other: 'openLink' },
} as const

export function noteLinkTitle(link: Wikilink, missing: boolean): string {
  const wording = isTabFile(link.target) ? HOW.file : HOW[missing ? 'create' : 'open']
  return `${linkTarget(link)}\n${label(MAC ? wording.mac : wording.other)}`
}

export function jumpAt(state: EditorState, pos: number): NoteJump | null {
  const link = linkAt(state, pos)
  return link && jumpFor(state.facet(noteIndex), link, link.kind)
}

function followNoteAt(view: EditorView, pos: number, press?: LinkPress): boolean {
  const jump = jumpAt(view.state, pos)
  if (!jump) return false

  view.state.facet(noteOpener)(jump, press)
  return true
}

export const followNoteAtCaret: Command = (view) =>
  followNoteAt(view, view.state.selection.main.head)

export const noteClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    const asked =
      event.button === 1 || (event.button === 0 && (modifier(event) || view.state.readOnly))
    if (!asked) return false

    const target = event.target
    const link = target instanceof Element ? target.closest('.orden-link[data-note]') : null
    if (!link) return false

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false

    event.preventDefault()
    return followNoteAt(view, pos, event)
  },
})
