/** How a name field arrives: focused, and with the caret where the typing is
 *  meant to go.
 *
 *  Three ways, because there are three things a name field is for. A question in
 *  a sheet is answered instead of what it suggests, so everything is selected. A
 *  rename replaces the name and keeps the kind of file it is, so the extension
 *  stays out of the selection, which is what Finder and Explorer both do. A note
 *  that was made with a name of its own - a unique note's timestamp - is waiting
 *  for a title after it, so the caret goes to the end instead.
 *
 *  Not `autofocus`. Svelte honours that only when nothing else has focus, and
 *  the menu entry that starts a rename still has it while the menu fades out -
 *  so the field never got focus, and selecting on focus never ran. These take
 *  it: once as the field appears, and once more a frame later, for a value that
 *  is filled in after that. */
function takes(node: HTMLInputElement, place: (node: HTMLInputElement) => void) {
  const take = () => {
    node.focus()
    place(node)
  }

  take()
  const again = requestAnimationFrame(take)
  return { destroy: () => cancelAnimationFrame(again) }
}

export function selectAll(node: HTMLInputElement) {
  return takes(node, (field) => field.select())
}

export function caretAtEnd(node: HTMLInputElement) {
  return takes(node, (field) => field.setSelectionRange(field.value.length, field.value.length))
}

/** Everything up to the extension: typing replaces the name and `paper.pdf` is
 *  still a PDF afterwards. A note or a canvas is shown without the extension it
 *  was written with, so there is nothing to leave out and this selects the whole
 *  of it; a dotted name is selected whole too, since the dot at the front of
 *  `.gitignore` is part of the name rather than in front of an extension. */
export function selectStem(node: HTMLInputElement) {
  return takes(node, (field) => {
    const dot = field.value.lastIndexOf('.')
    field.setSelectionRange(0, dot > 0 ? dot : field.value.length)
  })
}
