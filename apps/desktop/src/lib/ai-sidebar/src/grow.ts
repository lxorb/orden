import type { Action } from 'svelte/action'

const SIZES_ITSELF = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')

export const grow: Action<HTMLTextAreaElement, unknown> = (field) => {
  if (SIZES_ITSELF) return {}

  const fit = () => {
    const style = getComputedStyle(field)
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    field.style.height = 'auto'
    field.style.height = `${String(field.scrollHeight + borders)}px`
  }

  field.addEventListener('input', fit)
  fit()

  return {
    update: () => requestAnimationFrame(fit),
    destroy: () => field.removeEventListener('input', fit),
  }
}
