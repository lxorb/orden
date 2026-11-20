export type Finder = () => HTMLElement | null
export function keepFocus(node: HTMLElement, place: (focused: HTMLElement) => Finder | null) {
  let find: Finder | null = null
  let held: HTMLElement | null = null
  const into = (event: FocusEvent) => {
    if (!(event.target instanceof HTMLElement)) return
    held = event.target
    find = place(event.target)
  }
  const watch = new MutationObserver(() => {
    if (!held || held.isConnected) return
    const now = document.activeElement
    const lost = !now || now === document.body || !now.isConnected
    const finder = find
    held = null
    find = null
    if (!lost) return
    const next = finder?.() ?? null
    ;(next ?? node).focus({ preventScroll: true })
  })
  node.addEventListener('focusin', into)
  watch.observe(node, { childList: true, subtree: true })
  return {
    destroy() {
      node.removeEventListener('focusin', into)
      watch.disconnect()
    },
  }
}
export function cardPlace(node: HTMLElement, focused: HTMLElement): Finder | null {
  const card = focused.closest<HTMLElement>('[data-card]')
  const box = card?.closest<HTMLElement>('[data-column]')
  const index = Number(card?.closest<HTMLElement>('[data-index]')?.dataset.index)
  if (!card || !box || !Number.isFinite(index)) return null
  const column = box.dataset.column ?? ''
  const lane = box.dataset.lane
  return () => {
    const here = [...node.querySelectorAll<HTMLElement>('[data-column]')].find(
      (one) => one.dataset.column === column && one.dataset.lane === lane,
    )
    if (!here) return null
    const at = (wanted: number) => here.querySelector<HTMLElement>(`[data-index="${wanted}"] [data-card]`)
    return at(index) ?? at(index - 1) ?? here.querySelector<HTMLElement>('[data-new-page]')
  }
}
