/** Asking for a picture off the device.
 *
 *  A file input and nothing else, which is the one picker every platform already
 *  has: on a desktop it is the system's file dialog, in a browser the same, and on
 *  Android `accept="image/*"` is what makes the sheet offer the gallery, the
 *  camera and the files app together. Nothing to write per platform, and the
 *  camera comes free.
 *
 *  Deliberately not `capture`, which would force the camera and take the gallery
 *  away: somebody putting a photograph on a plane usually already has it. The
 *  camera is one row down the sheet Android opens anyway.
 *
 *  Its own file because it is the one bit of the canvas that has to touch the
 *  document, and because a drop, a paste and this all end in the same place: the
 *  bytes go through `assets.ts` and the plane gets a `file` node pointing at them. */

/** What a canvas will take as a picture. The same list `isPicture` recognises on
 *  the way back out, so a picture that can be put on a plane is one the plane
 *  draws. */
const TAKES = 'image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.bmp'

/** The pictures somebody chose, or none at all if they thought better of it.
 *
 *  The input is put in the document because a browser will not open a picker for
 *  an element that is not there, and taken out again as soon as it has answered.
 *  It is never shown: `hidden` would stop the click on some browsers, so it is
 *  simply nowhere anybody can see. */
export function pickPictures(several = false): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([])

  return new Promise((settle) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = TAKES
    input.multiple = several
    input.style.position = 'fixed'
    input.style.left = '-1000px'
    input.style.opacity = '0'

    let answered = false
    const answer = (files: File[]) => {
      if (answered) return

      answered = true
      input.remove()
      settle(files)
    }

    input.addEventListener('change', () => answer([...(input.files ?? [])]))
    // A picker closed with nothing chosen. Not every browser fires it, so the
    // promise is also settled by the change above and by nothing at all: an
    // unresolved promise here costs one closure and no picker stays open.
    input.addEventListener('cancel', () => answer([]))

    document.body.append(input)
    input.click()
  })
}
