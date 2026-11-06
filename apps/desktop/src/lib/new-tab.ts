import { linkModifier } from '@orden/editor'

export interface Press {
  button?: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey?: boolean
}

export type TabAsk = 'plain' | 'behind' | 'front'

export type LinkAsk = TabAsk | 'aside'

const MIDDLE = 1

export function tabAsk(press: Press, shiftOpens = false): TabAsk {
  if (press.button === MIDDLE || linkModifier(press)) return press.shiftKey ? 'front' : 'behind'
  return shiftOpens && press.shiftKey ? 'front' : 'plain'
}

export function linkAsk(press: Press): LinkAsk {
  return press.altKey && linkModifier(press) ? 'aside' : tabAsk(press)
}

export interface OpenHow {
  activate?: boolean
  preview?: boolean
  beside?: boolean
}

export function howFor(ask: TabAsk, plain: OpenHow = {}): OpenHow {
  if (ask === 'plain') return plain
  return ask === 'behind' ? { activate: false, beside: true } : { beside: true }
}

export function besideAt(
  strip: readonly { id: string }[],
  opener: string,
  previous: string | null,
): number | null {
  const from = strip.findIndex((one) => one.id === opener)
  if (from < 0) return null

  const last = previous === null ? -1 : strip.findIndex((one) => one.id === previous)
  return Math.max(from, last) + 1
}

export function middleOpens(node: HTMLElement, open: (event: MouseEvent) => void) {
  let current = open

  const down = (event: MouseEvent) => {
    if (event.button === MIDDLE) event.preventDefault()
  }
  const up = (event: MouseEvent) => {
    if (event.button !== MIDDLE) return
    event.preventDefault()
    current(event)
  }

  node.addEventListener('mousedown', down)
  node.addEventListener('auxclick', up)

  return {
    update(next: (event: MouseEvent) => void) {
      current = next
    },
    destroy() {
      node.removeEventListener('mousedown', down)
      node.removeEventListener('auxclick', up)
    },
  }
}
