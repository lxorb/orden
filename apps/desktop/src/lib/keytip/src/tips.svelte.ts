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
export function follow(node: HTMLElement, label: () => string, keys: () => string | undefined, first: Event) {
  let waiting: ReturnType<typeof setTimeout> | undefined
  const show = () => {
    const text = label()
    if (text && !viewport.touch) showTip(node, text, keys() ?? '')
  }
  const enter = () => {
    clearTimeout(waiting)
    waiting = setTimeout(show, WAIT)
  }
  const leave = () => {
    clearTimeout(waiting)
    hideTip(node)
  }
  const focus = () => {
    if (node.matches(':focus-visible')) show()
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
