import type { TransitionConfig } from 'svelte/transition'
import { cubicOut } from 'svelte/easing'
import { dur } from './motion'

const STEP = 6
export const LIST_STEP = 8

const SWAP = 130

interface Slip {
  y?: number
  ms?: number
}

function slip(y: number, ms: number): TransitionConfig {
  return {
    duration: dur(ms),
    easing: cubicOut,
    css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`,
  }
}

export function arrive(_node: Element, { y = STEP, ms = SWAP }: Slip = {}): TransitionConfig {
  return slip(y, ms)
}

export function leave(_node: Element, { y = -STEP, ms = SWAP }: Slip = {}): TransitionConfig {
  return slip(y, ms)
}

export function letGo(_node: Element, { ms = SWAP }: { ms?: number } = {}): TransitionConfig {
  return { duration: dur(ms), css: () => 'pointer-events: none' }
}

export function segmented(node: HTMLElement) {
  const thumb = document.createElement('span')
  thumb.className = 'nib-segmented-thumb'
  thumb.setAttribute('aria-hidden', 'true')

  node.prepend(thumb)
  node.classList.add('has-thumb')

  function place() {
    const on = node.querySelector<HTMLElement>('button.on')

    if (!on) {
      thumb.style.opacity = '0'
      return
    }

    thumb.style.opacity = ''
    thumb.style.width = `${on.offsetWidth}px`
    thumb.style.height = `${on.offsetHeight}px`
    thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`
  }

  thumb.style.transition = 'none'
  place()
  const settled = requestAnimationFrame(() => (thumb.style.transition = ''))

  const watched = new MutationObserver(place)
  watched.observe(node, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  })

  const measured = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
  measured?.observe(node)

  return {
    destroy() {
      cancelAnimationFrame(settled)
      watched.disconnect()
      measured?.disconnect()
      thumb.remove()
      node.classList.remove('has-thumb')
    },
  }
}
