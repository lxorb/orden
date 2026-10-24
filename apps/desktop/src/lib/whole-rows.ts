/** A list that is cut, when it has to be, between two rows (#775).
 *
 *  The palette's list is as tall as the layer it is in leaves it: the field over it,
 *  and `.nib-screen`'s one cap on every layer of its kind. Wherever that cap fell it cut
 *  the list, so a list a few pixels longer than its room - Ctrl+O's own rows on any tall
 *  window, by 6.5 pixels of which 4 were its padding - had a scrollbar over nothing left
 *  to scroll to. So the room is taken in whole rows: the list ends at the bottom of the
 *  last row that fits, with its padding under it, and a list that fits is never cut at
 *  all. What is left to scroll to is then always a row.
 *
 *  Measured, not computed: the rows are not one height - a group's heading is shorter
 *  than a row, and a touch screen's rows are taller - and the room is whatever the
 *  layout leaves on this window, at this text size. */

/** Where the rows of a list end, for a list whose room is `room`, padding and all:
 *  nothing where every row fits, and otherwise the bottom of the last row
 *  that does with the list's own end padding under it. A heading is never left as the
 *  last thing above the cut, since what it heads would all be out of sight. `bottoms`
 *  are where each row ends, measured from the top of the list's box. */
export function cutAt(
  bottoms: readonly number[],
  headings: readonly boolean[],
  room: number,
  padEnd: number,
): number | null {
  const last = bottoms.at(-1)
  if (last === undefined || last + padEnd <= room) return null

  let fits = -1
  for (let at = 0; at < bottoms.length; at++) {
    if ((bottoms[at] ?? 0) + padEnd <= room) fits = at
  }
  while (fits >= 0 && headings[fits]) fits--

  return fits < 0 ? null : (bottoms[fits] ?? 0) + padEnd
}

/** `use:wholeRows={what}` on a scrolling list whose children are its rows. `what` is
 *  anything that changes when the rows do, so the cut is taken again; a window
 *  resized takes it again too. A row with `nib-section` heads a group. The list is
 *  measured as a border box, so the cut holds its padding. */
export function wholeRows(list: HTMLElement, _rows?: unknown) {
  const fit = () => {
    // What the layout gives the list with no cut of its own, read first.
    list.style.maxHeight = ''
    const room = list.clientHeight
    if (list.scrollHeight <= room) return

    const top = list.getBoundingClientRect().top - list.scrollTop
    const rows = [...list.children]
    const cut = cutAt(
      rows.map((one) => one.getBoundingClientRect().bottom - top),
      rows.map((one) => one.classList.contains('nib-section')),
      room,
      parseFloat(getComputedStyle(list).paddingBottom) || 0,
    )
    if (cut !== null) list.style.maxHeight = `${cut}px`
  }

  fit()
  window.addEventListener('resize', fit)

  return {
    update: fit,
    destroy: () => window.removeEventListener('resize', fit),
  }
}
