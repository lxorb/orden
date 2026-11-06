export function pressedByKey(node: HTMLElement, onPress: () => void): void {
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    event.stopPropagation()
    onPress()
  })
}
