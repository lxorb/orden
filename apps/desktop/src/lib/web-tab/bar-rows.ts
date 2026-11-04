/** Whether a web tab's bar puts its address field on a line of its own (#1118).
 *
 *  The bar is a wrapping row: back, forward, reload and the site, the field, then the
 *  extensions, the downloads and the dots. Left to wrap by itself, a pane a little too
 *  narrow for all of it moved the *last* glyph down, so the dots sat alone on a second
 *  line at the far left and the rest of that line was empty: a dark band between the
 *  address and the page, which read as the page not starting where it should. So the
 *  bar decides instead, the way a browser in a narrow window does: everything fits on
 *  one line, or the glyphs keep a line of their own - the ones in front of the field at
 *  its start, the ones after it at its end - and the field takes the whole line under
 *  them. Never a line holding a glyph and nothing else.
 *
 *  The question is the one the row's own wrapping asks: whether the glyphs, the field at
 *  its basis and the gaps between them are wider than the room. Asked of the same
 *  numbers whichever way the bar stands, so it cannot flicker between the two. */

/** Whether the field goes on a line of its own: what is beside it, the field at its
 *  basis and a gap between each two of them do not fit in `room`. Pure. */
export function fieldAlone(
  room: number,
  beside: readonly number[],
  field: number,
  gap: number,
): boolean {
  const wanted = beside.reduce((sum, one) => sum + one, field) + gap * beside.length
  // Half a pixel, which is what laying out in fractions of one owes a sum.
  return wanted > room + 0.5
}

const px = (value: string) => parseFloat(value) || 0

/** How wide one of the bar's items asks to be, margins and all: its laid-out width,
 *  which a glyph's scale as it arrives leaves alone, or for the field its basis, which
 *  is what it asks for before it grows. */
function asked(one: Element, field: boolean): number {
  const style = getComputedStyle(one)
  const width = field && style.flexBasis.endsWith('px') ? style.flexBasis : style.width
  return px(width) + px(style.marginLeft) + px(style.marginRight)
}

/** Whether the field of `bar` goes on a line of its own, as laid out now. */
function aloneIn(bar: HTMLElement, field: Element): boolean {
  const style = getComputedStyle(bar)
  const room = bar.clientWidth - px(style.paddingLeft) - px(style.paddingRight)
  const beside = [...bar.children]
    .filter((one) => one !== field && getComputedStyle(one).display !== 'none')
    .map((one) => asked(one, false))
  return fieldAlone(room, beside, asked(field, true), px(style.columnGap))
}

/** Tells `say` whether the field of `bar` goes on a line of its own, now and whenever
 *  the bar or anything in it changes size, comes or goes - a download's glyph, an
 *  extension pinned. Answers how to stop. */
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
