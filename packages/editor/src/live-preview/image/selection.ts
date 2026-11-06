import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { Command } from '@codemirror/view'
import type { BindingSpec } from '../../shortcuts'
import { openParagraphBelow } from '../../tail'
import { noReveal } from '../reveal'
import { imageAt, imageEndingAt, type ImageSpan, sourceCaret } from './markup'

const inside = (pos: number, from: number, to: number) => pos > from && pos < to

export function imageRevealed(state: EditorState, from: number, to: number): boolean {
  if (state.facet(noReveal)) return false
  return state.selection.ranges.some(
    (range) => inside(range.from, from, to) || inside(range.to, from, to),
  )
}

export function selectedImage(state: EditorState): ImageSpan | null {
  const range = state.selection.main
  if (range.empty) return null
  const image = imageAt(state, range.from)
  return image?.to === range.to ? image : null
}

export function selectionOver(image: ImageSpan) {
  return EditorSelection.range(image.from, image.to)
}

export const selectImageBehind: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const image = imageEndingAt(state, range.head)
  if (!image || imageRevealed(state, image.from, image.to)) return false

  dispatch(state.update({ selection: selectionOver(image), userEvent: 'select.image' }))
  return true
}

export const selectImageAhead: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main
  if (!range.empty) return false

  const image = imageAt(state, range.head)
  if (!image || imageRevealed(state, image.from, image.to)) return false

  dispatch(state.update({ selection: selectionOver(image), userEvent: 'select.image' }))
  return true
}

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

export const leaveSelectedImage: StateCommand = ({ state, dispatch }) => {
  const image = selectedImage(state)
  if (!image) return false

  dispatch(state.update({ selection: EditorSelection.cursor(image.to), userEvent: 'select' }))
  return true
}

function stepOff(forward: boolean): Command {
  return (view) => {
    const image = selectedImage(view.state)
    if (!image) return false

    const start = EditorSelection.cursor(forward ? image.to : image.from)
    const moved = view.moveVertically(start, forward)
    if (forward && moved.head === start.head && openParagraphBelow(view)) return true

    view.dispatch({
      selection: EditorSelection.create([moved.head === start.head ? start : moved]),
      scrollIntoView: true,
      userEvent: 'select',
    })
    return true
  }
}

export const imageBindings: BindingSpec[] = [
  { id: 'image.select-behind', key: 'Backspace', run: selectImageBehind, contextual: true },
  { id: 'image.select-ahead', key: 'Delete', run: selectImageAhead, contextual: true },
  { id: 'image.edit', key: 'Enter', run: editSelectedImage, contextual: true },
  { id: 'image.leave', key: 'Escape', run: leaveSelectedImage, contextual: true },
  { id: 'image.step-up', key: 'ArrowUp', run: stepOff(false), contextual: true },
  { id: 'image.step-down', key: 'ArrowDown', run: stepOff(true), contextual: true },
]
