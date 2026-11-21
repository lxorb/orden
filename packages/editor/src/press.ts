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
interface Down {
  id: number
  x: number
  y: number
}
const still = (down: Down | null, event: PointerEvent): down is Down =>
  down !== null && down.id === event.pointerId && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= STILL
export function pressedByPointer(
  node: HTMLElement,
  onPress: (event: PointerEvent) => void,
  skip: (event: PointerEvent) => boolean = () => false,
): void {
  let down: Down | null = null
  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || skip(event)) return
    if (touching(event)) down = { id: event.pointerId, x: event.clientX, y: event.clientY }
    else onPress(event)
  })
  node.addEventListener('pointermove', (event) => {
    if (!still(down, event)) down = null
  })
  node.addEventListener('pointercancel', () => {
    down = null
  })
  node.addEventListener('pointerup', (event) => {
    const was = down
    down = null
    if (still(was, event)) onPress(event)
  })
}
