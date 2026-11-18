import { type Component, flushSync, mount, unmount } from 'svelte'

export let target: HTMLElement
let drawn: ReturnType<typeof mount> | undefined

export function landed() {
  target = document.createElement('div')
  document.body.append(target)
}

export function draw<P extends Record<string, unknown>>(component: Component<P>, props: P) {
  drawn = mount(component, { target, props, intro: false })
  flushSync()
}

export function showing<P extends Record<string, unknown>>(component: Component<P>, props: P) {
  landed()
  draw(component, props)
}

export function closed() {
  if (drawn) void unmount(drawn)
  drawn = undefined
  target.remove()
}

export function typed(field: HTMLInputElement | null | undefined, text: string) {
  if (!field) throw new Error('no field')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
