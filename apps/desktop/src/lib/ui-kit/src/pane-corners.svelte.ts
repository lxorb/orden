import type { Snippet } from 'svelte'

class PaneCorners {
  draw = $state.raw<Snippet | null>(null)
}

export const paneCorners = new PaneCorners()

export function frameOf(element: HTMLElement | null | undefined): {
  left: number
  top: number
  width: number
  height: number
} {
  const held = element?.offsetParent
  if (held) {
    const box = held.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}
