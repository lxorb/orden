export function fieldAlone(
  room: number,
  beside: readonly number[],
  field: number,
  gap: number,
): boolean {
  const wanted = beside.reduce((sum, one) => sum + one, field) + gap * beside.length
  return wanted > room + 0.5
}

const px = (value: string) => parseFloat(value) || 0

function asked(one: Element, field: boolean): number {
  const style = getComputedStyle(one)
  const width = field && style.flexBasis.endsWith('px') ? style.flexBasis : style.width
  return px(width) + px(style.marginLeft) + px(style.marginRight)
}

function aloneIn(bar: HTMLElement, field: Element): boolean {
  const style = getComputedStyle(bar)
  const room = bar.clientWidth - px(style.paddingLeft) - px(style.paddingRight)
  const beside = [...bar.children]
    .filter((one) => one !== field && getComputedStyle(one).display !== 'none')
    .map((one) => asked(one, false))
  return fieldAlone(room, beside, asked(field, true), px(style.columnGap))
}

export function watchRows(bar: HTMLElement, say: (alone: boolean) => void): () => void {
  if (typeof ResizeObserver !== 'function') return () => undefined

  const look = () => {
    const field = bar.querySelector(':scope > .field')
    say(field ? aloneIn(bar, field) : false)
  }
  const sizes = new ResizeObserver(look)
  const watch = () => {
    sizes.disconnect()
    sizes.observe(bar)
    for (const one of bar.children) sizes.observe(one)
  }
  const comings = new MutationObserver(() => {
    watch()
    look()
  })
  comings.observe(bar, { childList: true })
  watch()
  look()
  return () => {
    sizes.disconnect()
    comings.disconnect()
  }
}
