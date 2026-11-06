import { boundKeymap } from '../../shortcuts'
import { imageSelection } from './frame'
import { imageBindings } from './selection'

export const imageExtension = [imageSelection, boundKeymap(imageBindings)]

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
export {
  imageAt,
  imageEndingAt,
  imageMarkup,
  imageOfNode,
  parseHtmlImage,
  sourceCaret,
} from './markup'
export { resizeTo, snapPercent } from './size'
