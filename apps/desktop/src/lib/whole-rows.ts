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

export function wholeRows(list: HTMLElement, _rows?: unknown) {
  const fit = () => {
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
