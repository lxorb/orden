import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { embedKind, embedSize } from '@orden/markdown/links'
import { imageResolver } from '../../images'
import { linkAt } from '../../wikilink/at'
import { openLightbox } from './lightbox'
import { imageAt } from './markup'

export interface Picture {
  from: number
  to: number
  src: string
  alt: string
}

export function pictureAt(state: EditorState, pos: number): Picture | null {
  const image = imageAt(state, pos)
  if (image) return { from: image.from, to: image.to, src: image.src, alt: image.alt }

  const link = linkAt(state, pos)
  if (!link?.embed || link.from !== pos || embedKind(link.target) !== 'image') return null

  const alt = link.alias !== null && !embedSize(link.alias) ? link.alias : ''
  return { from: link.from, to: link.to, src: link.target, alt }
}

export function pressedPicture(view: EditorView, target: EventTarget | null): Picture | null {
  const drawn =
    target instanceof Element ? target.closest('.nib-image-frame, .nib-embed-image') : null
  if (!drawn || !view.contentDOM.contains(drawn)) return null

  return pictureAt(view.state, view.posAtDOM(drawn))
}

export function pictureUrl(state: EditorState, picture: Picture): string {
  return state.facet(imageResolver)(picture.src)
}

export function showPicture(view: EditorView, picture: Picture) {
  openLightbox(view, pictureUrl(view.state, picture), picture.alt)
}

export function deletePicture(picture: Picture): StateCommand {
  return ({ state, dispatch }) => {
    const still = pictureAt(state, picture.from)
    if (state.readOnly || still?.to !== picture.to) return false

    dispatch(
      state.update({
        changes: { from: picture.from, to: picture.to },
        selection: EditorSelection.cursor(picture.from),
        userEvent: 'delete.image',
      }),
    )
    return true
  }
}
