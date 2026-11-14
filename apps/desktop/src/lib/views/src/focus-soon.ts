export function focusSoon(node: HTMLInputElement): void {
  requestAnimationFrame(() => {
    node.focus()
    node.select()
  })
}
