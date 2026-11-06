const FOCUSABLE = [
  'button',
  '[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
]
  .map((one) => `${one}:not(:disabled):not([tabindex="-1"])`)
  .join(', ')

function within(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (one) => one.getClientRects().length > 0 && one.getAttribute('aria-hidden') !== 'true',
  )
}

function lands(node: HTMLElement): HTMLElement | null {
  if (document.documentElement.hasAttribute('data-touch')) {
    return node.matches('.nib-host[tabindex]') ? node : null
  }

  return node.querySelector<HTMLElement>('[data-lands]:not(:disabled)')
}

export const IN_A_PAGE = 'data-keyboard-in-page'

export function trap(node: HTMLElement, holds = true) {
  if (!holds) return { destroy: () => undefined }

  const from = document.documentElement.hasAttribute(IN_A_PAGE) ? null : document.activeElement

  if (!node.contains(document.activeElement)) {
    const first = lands(node) ?? within(node)[0]
    if (first) first.focus()
    else {
      if (!node.hasAttribute('tabindex')) node.tabIndex = -1
      node.focus()
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Tab') return

    const stops = within(node)
    if (!stops.length) {
      event.preventDefault()
      return
    }

    const first = stops[0]
    const last = stops.at(-1)
    if (!first || !last) return

    const at = document.activeElement
    if (!node.contains(at)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
      return
    }

    if (event.shiftKey && at === first) {
      event.preventDefault()
      last.focus()
      return
    }

    if (!event.shiftKey && at === last) {
      event.preventDefault()
      first.focus()
    }
  }

  node.addEventListener('keydown', onKey)

  function ours(): boolean {
    const at = document.activeElement
    if (at === null || at === document.body || at === document.documentElement) return true

    return node.contains(at)
  }

  return {
    destroy() {
      node.removeEventListener('keydown', onKey)
      if (!ours()) return

      if (from instanceof HTMLElement && from.isConnected && from.getClientRects().length > 0) {
        from.focus()
      }
    },
  }
}
