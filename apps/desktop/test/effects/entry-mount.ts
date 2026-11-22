import { flushSync, mount, unmount } from 'svelte'

export const JOIN_SHELL = '[aria-label="Opening what was shared with you"]'
export const SETUP_SHELL = '.shell[aria-label="Orden"][aria-busy="true"]'
export async function firstFrame(): Promise<{ has: (selector: string) => boolean; end: () => void }> {
  Element.prototype.animate = () =>
    ({
      cancel: () => undefined,
      finished: Promise.resolve(),
      playState: 'finished',
      effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    }) as unknown as Animation
  Element.prototype.getAnimations = () => []
  Element.prototype.scrollIntoView = () => undefined
  const App = (await import('../../src/App.svelte')).default
  const held = document.createElement('div')
  document.body.append(held)
  const drawn = mount(App, { target: held })
  flushSync()
  const seen = new Set([JOIN_SHELL, SETUP_SHELL].filter((one) => document.querySelector(one)))
  return {
    has: (selector) => seen.has(selector),
    end: () => {
      void unmount(drawn, { outro: false })
      held.remove()
    },
  }
}
