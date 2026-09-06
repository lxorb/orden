import { boundKeymap } from '../../shortcuts'
import { imageSelection } from './frame'
import { imageBindings } from './selection'

/** Images in the live preview.
 *
 *  A picture is an object in the text, not a run of characters, and it is
 *  treated as one:
 *
 *  - It stays a picture while the caret is beside it. Only a caret strictly
 *    inside the markup (`![alt](src)` or an `<img>` tag) shows the markup, and
 *    the caret only gets there on purpose: Enter on a selected image, or the
 *    toolbar's "Edit markdown". Everywhere else the preview reveals syntax as
 *    soon as the caret touches it; for an image that would collapse a
 *    400px picture into a line of text whenever an arrow key passed by.
 *  - A click selects it: the selection becomes exactly the image's range, the
 *    editor keeps focus, and the picture gets a frame, corner handles and a
 *    small toolbar. Because it is a real selection, everything the editor
 *    already knows applies: typing replaces it, Backspace and Delete remove
 *    it, Ctrl+C copies its markdown, arrow keys step off it, Shift+click
 *    extends over it.
 *  - Backspace right after a rendered image, or Delete right before one,
 *    selects it rather than deleting it, so a picture is never lost to a
 *    keystroke aimed at a character. The second press deletes.
 *  - Double click opens the lightbox, as does the toolbar's open button.
 *  - Dragging a corner resizes. The size is the width as a percentage of the
 *    image's natural width, which is what Typora stores as
 *    `style="zoom:N%"`. It snaps to quarters, thirds and full size (Alt drags
 *    freely), never exceeds 100%, and a badge shows the value while dragging.
 *    Back at 100% the markup is plain `![alt](src)` again.
 *  - The toolbar edits the alt text in place, shows and resets the size,
 *    opens the lightbox, copies the path, reveals the markdown and deletes.
 *  - A path that does not load shows the path in a placeholder, so a broken
 *    link is read rather than guessed at; the sizes of images seen once are
 *    remembered, so a picture rebuilt after an edit takes its room before it
 *    has loaded again, and nothing below it jumps.
 *
 *  Which of those lives where: markup.ts reads an image out of the document and
 *  writes one back, selection.ts makes selecting one a real editor selection and
 *  gives the six keys that mind a picture, size.ts is the arithmetic of a drag,
 *  widget.ts is everything on screen, frame.ts keeps the selected frame marked,
 *  and lightbox.ts is the full-window preview. */
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
