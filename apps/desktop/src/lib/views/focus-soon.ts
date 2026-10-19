/** A field put up from a menu: focused once the menu has handed the keyboard back to
 *  what opened it, which it does as it closes, and its words chosen. A Svelte action:
 *  `<input use:focusSoon />`. */
export function focusSoon(node: HTMLInputElement): void {
  requestAnimationFrame(() => {
    node.focus()
    node.select()
  })
}
