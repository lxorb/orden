/** Puts an element at the end of the page while it is up, for a layer opened from
 *  inside another one.
 *
 *  A layer that is placed in the window's own coordinates - `position: fixed`, as a
 *  chat's small layers are (chats/view/Float.svelte) - is placed in its container's
 *  instead wherever an ancestor is moved with `translate` or `transform`, and every
 *  centred sheet is: the emoji picker opened from Settings > Account hung off the
 *  corner of the settings and pushed them sideways. At the end of the body there is
 *  no such ancestor. */
export function portal(node: HTMLElement) {
  document.body.append(node)
  return { destroy: () => node.remove() }
}
