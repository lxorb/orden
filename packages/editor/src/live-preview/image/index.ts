import { EditorView } from '@codemirror/view'
import { boundKeymap } from '../../shortcuts'
import { imageSelection } from './frame'
import { imageBindings, selectedImage } from './selection'

const picked = EditorView.editorAttributes.compute(['selection'], (state) =>
  selectedImage(state) ? { class: 'orden-picture-picked' } : {},
)
const noCaret = EditorView.baseTheme({ '&.orden-picture-picked .cm-cursorLayer': { display: 'none' } })
export const imageExtension = [imageSelection, picked, noCaret, boundKeymap(imageBindings)]
export { ImageWidget } from './widget'
export {
  editSelectedImage,
  imageBindings,
  imageRevealed,
  leaveSelectedImage,
  selectImageAhead,
  selectImageBehind,
  selectedImage,
} from './selection'
export { imageAt, imageEndingAt, imageMarkup, imageOfNode, parseHtmlImage, retag, sourceCaret } from './markup'
export { resizeTo, snapPercent } from './size'
