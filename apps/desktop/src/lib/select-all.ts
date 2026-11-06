function takes(node: HTMLInputElement, place: (node: HTMLInputElement) => void) {
  const take = () => {
    node.focus()
    place(node)
  }

  const settled = () => {
    cancelAnimationFrame(again)
    window.removeEventListener('keydown', settled, true)
    window.removeEventListener('pointerdown', settled, true)
  }

  take()
  const again = requestAnimationFrame(() => {
    settled()
    take()
  })
  window.addEventListener('keydown', settled, true)
  window.addEventListener('pointerdown', settled, true)
  return { destroy: settled }
}

export function selectAll(node: HTMLInputElement) {
  return takes(node, (field) => field.select())
}

export function caretAtEnd(node: HTMLInputElement) {
  return takes(node, (field) => field.setSelectionRange(field.value.length, field.value.length))
}

export function selectStem(node: HTMLInputElement) {
  return takes(node, (field) => {
    const dot = field.value.lastIndexOf('.')
    field.setSelectionRange(0, dot > 0 ? dot : field.value.length)
  })
}
