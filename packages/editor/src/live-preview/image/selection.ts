import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import type { BindingSpec } from '../../shortcuts'
import { noReveal } from '../reveal'
import { imageAt, imageEndingAt, type ImageSpan, sourceCaret } from './markup'

/** Selecting a picture, and the keys that mind one.
 *
 *  What makes a picture behave like an object rather than a run of characters is
 *  that selecting it is a real editor selection over exactly its range. Typing
 *  replaces it, Backspace removes it, Ctrl+C copies its markdown, and none of
 *  that had to be written here - it follows from the selection being real.
 *
 *  What did have to be written are the six keys below, and each of them gives
 *  way when no picture is where it is looking, so they share their keys with the
 *  editor's own motion instead of taking them over. */

const inside = (pos: number, from: number, to: number) => pos > from && pos < to

/** Only a caret strictly inside the markup reveals it; touching an end does
 *  not, and neither does a selection covering it. */
export function imageRevealed(state: EditorState, from: number, to: number): boolean {
  if (state.facet(noReveal)) return false
  return state.selection.ranges.some(
    (range) => inside(range.from, from, to) || inside(range.to, from, to),
  )
}

/** The image the main selection covers exactly, if that is what is selected. */
export function selectedImage(state: EditorState): ImageSpan | null {
  const range = state.selection.main
  if (range.empty) return null
  const image = imageAt(state, range.from)
  return image?.to === range.to ? image : null
}

export function selectionOver(image: ImageSpan) {
  return EditorSelection.range(image.from, image.to)
}

/** Backspace directly after a rendered image selects it: the first press
 *  shows what is about to go, the second removes it. */
export const selectImageBehind: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const image = imageEndingAt(state, range.head)
  if (!image || imageRevealed(state, image.from, image.to)) return false

  dispatch(state.update({ selection: selectionOver(image), userEvent: 'select.image' }))
  return true
}

/** Delete directly before a rendered image, likewise. */
export const selectImageAhead: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const image = imageAt(state, range.head)
  if (!image || imageRevealed(state, image.from, image.to)) return false

  dispatch(state.update({ selection: selectionOver(image), userEvent: 'select.image' }))
  return true
}

/** Enter on a selected image opens its markup, caret after the alt text. */
export const editSelectedImage: StateCommand = ({ state, dispatch }) => {
  const image = selectedImage(state)
  if (!image) return false

  dispatch(
    state.update({
      selection: EditorSelection.cursor(sourceCaret(state, image)),
      scrollIntoView: true,
      userEvent: 'select',
    }),
  )
  return true
}

/** Escape on a selected image steps off it, to just after. */
export const leaveSelectedImage: StateCommand = ({ state, dispatch }) => {
  const image = selectedImage(state)
  if (!image) return false

  dispatch(state.update({ selection: EditorSelection.cursor(image.to), userEvent: 'select' }))
  return true
}

/** Up and down from a selected image go to the line above or below, as they
 *  would from a caret beside it, rather than merely collapsing the selection. */
function stepOff(forward: boolean): Command {
  return (view) => {
    const image = selectedImage(view.state)
    if (!image) return false

    const start = EditorSelection.cursor(forward ? image.to : image.from)
    const moved = view.moveVertically(start, forward)
    view.dispatch({
      selection: EditorSelection.create([moved.head === start.head ? start : moved]),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

/** All six give way when no picture is where they are looking, so they sit
 *  over the editor's own Backspace, Delete, Enter and arrows without taking
 *  those keys away. See `contextual` in shortcuts.ts. */
export const imageBindings: BindingSpec[] = [
  { id: 'image.select-behind', key: 'Backspace', run: selectImageBehind, contextual: true },
  { id: 'image.select-ahead', key: 'Delete', run: selectImageAhead, contextual: true },
  { id: 'image.edit', key: 'Enter', run: editSelectedImage, contextual: true },
  { id: 'image.leave', key: 'Escape', run: leaveSelectedImage, contextual: true },
  { id: 'image.step-up', key: 'ArrowUp', run: stepOff(false), contextual: true },
  { id: 'image.step-down', key: 'ArrowDown', run: stepOff(true), contextual: true },
]
