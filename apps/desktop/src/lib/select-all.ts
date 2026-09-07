/** How a name field arrives: focused, and with the caret where the typing is
 *  meant to go.
 *
 *  Two ways, because there are two things a name field is for. A rename replaces
 *  the name, so everything is selected. A note that was made with a name of its
 *  own - a unique note's timestamp - is waiting for a title after it, so the
 *  caret goes to the end instead.
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
