/** Enter and Space on a button the editor drew into a note.
 *
 *  These buttons are pressed on `mousedown` with the default stopped, and that is
 *  deliberate: a press must not move the caret out of the line it is in, and
 *  `mousedown` is where a webview decides to move it. What that leaves out is the
 *  keyboard. A `mousedown` listener never hears Enter, and a `<button>` in the tab
 *  order - which every one of these is, wearing the ring `base.css` puts on
 *  everything a key can land on and saying its name to a reader listening - is a
 *  promise that pressing it does the thing.
 *
 *  So this, beside the mousedown, at every one of them: the Run glyph and the
 *  question an `ai` block asks, Copy code and the fence's language, the twelve
 *  buttons around a table, the stop and the cross on a run's panel, the row that
 *  adds a property, and the card an embed draws.
 *
 *  Not on a button that is deliberately out of the tab order. The block's grip and
 *  a fold's hinge both set `tabIndex = -1`, because every foldable block would
 *  otherwise be a stop on the way through a note, and the keyboard reaches what
 *  they do through a command.
 *
 *  The default is stopped, which is what keeps the press from arriving a second
 *  time: a browser turns Enter and Space on a focused button into a `click`, and a
 *  button that acted on both would act twice. */
export function pressedByKey(node: HTMLElement, onPress: () => void): void {
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    event.stopPropagation()
    onPress()
  })
}
