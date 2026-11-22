import { dur } from '../../platform/src/api'
import { tick } from '../../ui-controls/src/api'

const ARM = 0.4
const FLUNG = 0.18
const FLING = 0.6
const SLOP = 10
const HOLD = 240
const SETTLE = 340
const LEAVE = 220
const STAY = 700
export type Swiped = 'done' | 'delete'
export function swiped(dx: number, dy: number, wide: number, speed = 0): Swiped | null {
  if (wide <= 0 || Math.abs(dx) <= Math.abs(dy) * 2) return null
  const far = Math.abs(dx) >= wide * ARM
  const flung = Math.abs(dx) >= wide * FLUNG && Math.abs(speed) >= FLING && Math.sign(speed) === Math.sign(dx)
  if (!far && !flung) return null
  return dx > 0 ? 'done' : 'delete'
}
export const swipeReach = (dx: number, wide: number): number =>
  wide > 0 ? Math.min(1, Math.abs(dx) / (wide * ARM)) : 0
export interface SwipeActs {
  done: () => void
  remove?: () => void
}
export function swipeRow(node: HTMLElement, acts: SwipeActs) {
  let now = acts
  let from: { x: number; y: number; id: number; at: number } | null = null
  let last = { x: 0, at: 0, speed: 0 }
  let sliding = false
  let armed = false
  let later: ReturnType<typeof setTimeout> | null = null
  const card = () => node.querySelector<HTMLElement>(':scope > .todo')
  const wait = (ms: number, then: () => void) => {
    if (later !== null) clearTimeout(later)
    later = setTimeout(() => {
      later = null
      then()
    }, ms)
  }
  const show = (x: number, wide: number) => {
    const side: Swiped = x > 0 ? 'done' : 'delete'
    const reach = swipeReach(x, wide)
    node.style.setProperty('--swipe-x', `${String(x)}px`)
    node.style.setProperty('--swipe-p', reach.toFixed(3))
    node.dataset.swipe = side
    const now = reach >= 1
    if (now !== armed) {
      armed = now
      if (armed) tick()
    }
    node.toggleAttribute('data-armed', armed)
  }
  const clear = () => {
    for (const name of ['swipe', 'armed', 'dragging', 'settling', 'leaving', 'ticked']) delete node.dataset[name]
    node.style.removeProperty('--swipe-x')
    node.style.removeProperty('--swipe-p')
    armed = false
  }
  const settle = (ticked: boolean) => {
    delete node.dataset.dragging
    node.dataset.settling = ''
    node.toggleAttribute('data-ticked', ticked)
    node.style.setProperty('--swipe-x', '0px')
    if (!ticked) node.style.setProperty('--swipe-p', '0')
    wait(dur(SETTLE), () => {
      if (ticked) now.done()
      clear()
    })
  }
  const leave = (wide: number) => {
    delete node.dataset.dragging
    node.dataset.leaving = ''
    node.style.setProperty('--swipe-x', `${String(-wide - 32)}px`)
    wait(dur(LEAVE), () => {
      now.remove?.()
      wait(STAY, () => {
        if (node.isConnected) settle(false)
      })
    })
  }
  const swallow = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || later !== null) return
    from = { x: event.clientX, y: event.clientY, id: event.pointerId, at: event.timeStamp }
    last = { x: event.clientX, at: event.timeStamp, speed: 0 }
    sliding = false
  }
  const move = (event: PointerEvent) => {
    if (from?.id !== event.pointerId) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (!sliding) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) * 2 >= Math.abs(dx)) from = null
      else if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 2 && event.timeStamp - from.at < HOLD) {
        if (dx < 0 && !now.remove) from = null
        else {
          sliding = true
          node.dataset.dragging = ''
        }
      } else if (event.timeStamp - from.at >= HOLD) from = null
      if (!sliding) return
    }
    const gap = event.timeStamp - last.at
    if (gap > 0) last = { x: event.clientX, at: event.timeStamp, speed: (event.clientX - last.x) / gap }
    const wide = card()?.offsetWidth ?? node.offsetWidth
    show(dx < 0 && !now.remove ? 0 : dx, wide)
  }
  const up = (event: PointerEvent) => {
    if (from?.id !== event.pointerId) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    from = null
    if (!sliding) return
    sliding = false
    node.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 400)
    const wide = card()?.offsetWidth ?? node.offsetWidth
    const end = swiped(dx, dy, wide, last.speed)
    if (end === 'delete' && now.remove) leave(wide)
    else settle(end === 'done')
  }
  const cancel = () => {
    from = null
    if (!sliding) return
    sliding = false
    settle(false)
  }
  node.addEventListener('pointerdown', down)
  node.addEventListener('pointermove', move)
  node.addEventListener('pointerup', up)
  node.addEventListener('pointercancel', cancel)
  node.addEventListener('orden-took-over', cancel)
  return {
    update(next: SwipeActs) {
      now = next
    },
    destroy() {
      if (later !== null) clearTimeout(later)
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', cancel)
      node.removeEventListener('orden-took-over', cancel)
    },
  }
}
