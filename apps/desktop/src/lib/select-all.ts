/** A field that arrives focused with everything in it selected, the way a
 *  rename should: typing replaces the name rather than adding to it.
 *
 *  Not `autofocus`. Svelte honours that only when nothing else has focus,
 *  and the menu entry that starts a rename still has it while the menu fades
 *  out - so the field never got focus, and selecting on focus never ran. This
 *  takes it. Once as the field appears, and once more a frame later, for a
 *  value that is filled in after that and would otherwise leave the caret at
 *  its end. */
export function selectAll(node: HTMLInputElement) {
  const take = () => {
    node.focus()
    node.select()
  }

  take()
  const again = requestAnimationFrame(take)
  return { destroy: () => cancelAnimationFrame(again) }
}
