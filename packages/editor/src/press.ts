export function pressedByKey(node: HTMLElement, onPress: () => void): void {
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onPress()
  })
}
const STILL = 8
const touching = (event: PointerEvent) => event.pointerType === 'touch' || event.pointerType === 'pen'
const far = (from: PointerEvent, to: PointerEvent) =>
  Math.hypot(to.clientX - from.clientX, to.clientY - from.clientY) > STILL
export function pressedByPointer(
  node: HTMLElement,
  onPress: (event: PointerEvent) => void,
  skip: (event: PointerEvent) => boolean = () => false,
): void {
  let down: PointerEvent | null = null
  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || skip(event)) return
    if (touching(event)) down = event
    else onPress(event)
  })
  node.addEventListener('pointermove', (event) => {
    if (down?.pointerId === event.pointerId && far(down, event)) down = null
  })
  node.addEventListener('pointercancel', () => {
    down = null
  })
  node.addEventListener('pointerup', (event) => {
    const was = down
    down = null
    if (was?.pointerId === event.pointerId && !far(was, event)) onPress(event)
  })
}
