import { type Component, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'

const { gate, SetupShell } = await import('./api')
const { setup } = await import('./setup-state.svelte')
const Setup = (await import('./Setup.svelte')).default
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.innerHTML = ''
  setup.showing = false
  localStorage.clear()
})
function shown(component: Component): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  const made = mount(component, { target, intro: false })
  close = () => void unmount(made)
  flushSync()
  return target
}
describe('the first frame of a setup', () => {
  test('is a shell that covers the app and says it is loading', () => {
    const shell = shown(SetupShell).querySelector('[role="dialog"]')
    expect(shell?.getAttribute('aria-busy')).toBe('true')
    expect(shell?.getAttribute('data-covers')).toBe('all')
  })
  test('gives way once the setup itself has come', () => {
    gate.ahead = 'setup'
    setup.begin(false)
    shown(Setup)
    expect(gate.ahead).toBeNull()
  })
})
