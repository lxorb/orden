import type { Box } from '../../../chat-kit/src/api'

const REST = 350

class Tips {
  shown = $state<{ text: string; at: Box } | null>(null)
}

export const tips = new Tips()

export function tip(node: HTMLElement, words: () => string) {
  let waiting: ReturnType<typeof setTimeout> | undefined
  let say = words

  const show = () => {
    const text = say()
    if (!text) return
    const box = node.getBoundingClientRect()
    tips.shown = {
      text,
      at: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    }
  }
  const enter = (event: PointerEvent) => {
    clearTimeout(waiting)
    waiting = setTimeout(show, event.pointerType === 'mouse' ? REST : REST * 1.5)
  }
  const leave = () => {
    clearTimeout(waiting)
    if (tips.shown) queueMicrotask(() => (tips.shown = null))
  }

  node.addEventListener('pointerenter', enter)
  node.addEventListener('pointerleave', leave)
  node.addEventListener('pointerdown', leave)
  node.addEventListener('focusin', show)
  node.addEventListener('focusout', leave)

  return {
    update(next: () => string) {
      say = next
    },
    destroy() {
      leave()
      node.removeEventListener('pointerenter', enter)
      node.removeEventListener('pointerleave', leave)
      node.removeEventListener('pointerdown', leave)
      node.removeEventListener('focusin', show)
      node.removeEventListener('focusout', leave)
    },
  }
}
