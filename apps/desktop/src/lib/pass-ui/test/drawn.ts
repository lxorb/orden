import type { Role, Vault } from '@orden/pass/types'
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
export function typed(field: HTMLInputElement | null, text: string) {
  if (!field) throw new Error('no field')
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
export function button(name: string, within: ParentNode = target): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find(
    (one) => one.textContent.trim() === name || one.getAttribute('aria-label') === name,
  )
  if (!found) throw new Error(`no ${name} button`)
  return found
}
export function vaultAs(role: Role, hidePasswordsFromViewers = false): Vault {
  return {
    v: 1,
    id: 'v1',
    name: 'Family',
    description: '',
    color: 'purple',
    icon: 'home',
    folders: [],
    hidePasswordsFromViewers,
    rev: 1,
    role,
    members: 4,
    shared: true,
  }
}
export async function until(ready: () => boolean, what: string): Promise<void> {
  for (let tries = 0; tries < 200; tries++) {
    flushSync()
    if (ready()) return
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error(`never: ${what}`)
}
