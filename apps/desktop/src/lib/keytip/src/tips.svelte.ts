import { mount } from 'svelte'
import { viewport } from '../../ui-kit/src/api'
import Tip from './Tip.svelte'

interface Shown {
  label: string
  keys: string
  at: { left: number; top: number; right: number; bottom: number }
  over: Element
}
class Showing {
  shown = $state<Shown | null>(null)
}
export const tip = new Showing()
let mounted = false
export function showTip(over: Element, label: string, keys: string): void {
  if (!mounted) {
    mount(Tip, { target: document.body })
    mounted = true
  }
  const box = over.getBoundingClientRect()
  tip.shown = { label, keys, at: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, over }
}
export function hideTip(over: Element): void {
  if (tip.shown?.over === over) tip.shown = null
}
const WAIT = 450
const CHECK = 200
export function follow(node: HTMLElement, label: () => string, keys: () => string | undefined, first: Event) {
  let waiting: ReturnType<typeof setTimeout> | undefined
  let checking: ReturnType<typeof setInterval> | undefined
  let byFocus = false
  const still = () =>
    node.isConnected && (byFocus ? node.matches(':focus-visible') : node.matches(':hover')) && document.hasFocus()
  const show = () => {
    const text = label()
    if (!text || viewport.touch || !still()) return
    showTip(node, text, keys() ?? '')
    watch(true)
  }
  const enter = () => {
    byFocus = false
    clearTimeout(waiting)
    waiting = setTimeout(show, WAIT)
  }
  const leave = () => {
    clearTimeout(waiting)
    watch(false)
    hideTip(node)
  }
  const focus = () => {
    byFocus = true
    show()
  }
  const outside = (event: MouseEvent) => {
    if (!event.relatedTarget) leave()
  }
  const hidden = () => {
    if (document.hidden) leave()
  }
  const away: [EventTarget, string, EventListener, boolean][] = [
    [window, 'blur', leave, false],
    [window, 'scroll', leave, true],
    [window, 'wheel', leave, true],
    [document, 'mouseout', outside as EventListener, false],
    [document, 'visibilitychange', hidden, false],
  ]
  function watch(on: boolean) {
    clearInterval(checking)
    for (const [where, name, run, capture] of away) where.removeEventListener(name, run, capture)
    if (!on) return
    checking = setInterval(() => !still() && leave(), CHECK)
    for (const [where, name, run, capture] of away) where.addEventListener(name, run, { capture, passive: true })
  }
  const on: [string, () => void][] = [
    ['pointerenter', enter],
    ['pointerleave', leave],
    ['pointerdown', leave],
    ['focusin', focus],
    ['focusout', leave],
  ]
  for (const [name, run] of on) node.addEventListener(name, run)
  if (first.type === 'focusin') focus()
  else enter()
  return () => {
    leave()
    for (const [name, run] of on) node.removeEventListener(name, run)
  }
}
