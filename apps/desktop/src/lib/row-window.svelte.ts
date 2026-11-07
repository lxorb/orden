import { scrollerOf } from './row-window'

const LEAST_ROW = 28
const LEAST_TOUCH = 56

export function tokenFloor(touch: boolean): number {
  return touch ? LEAST_TOUCH : LEAST_ROW
}

export function tokenRow(touch: boolean): number {
  const said = getComputedStyle(document.documentElement).getPropertyValue('--row-height')
  const px = Number.parseFloat(said)

  return Number.isFinite(px) && px > 0 ? px : touch ? LEAST_TOUCH : LEAST_ROW
}

export function measuredRow(list: HTMLElement, least: number): number {
  const first = list.querySelector(':scope > [data-row]:not(.away)')
  if (!(first instanceof HTMLElement)) return least

  const tall = first.getBoundingClientRect().height
  return tall > 0 ? tall : least
}

export class ListView {
  top = $state(0)
  room = $state(0)
  row = $state(0)
  box: HTMLElement | null = null

  #list: HTMLElement | null = null
  #rowOf: ((list: HTMLElement) => number) | null = null

  refresh(row?: number): void {
    const list = this.#list
    const rowOf = this.#rowOf
    const box = this.box
    if (!list || !rowOf || !box) return

    this.row = row ?? rowOf(list)
    this.top = box.getBoundingClientRect().top - list.getBoundingClientRect().top
    this.room = box.clientHeight
  }

  follow(
    list: HTMLElement,
    rowOf: (list: HTMLElement) => number,
    onScroll?: (box: HTMLElement) => void,
  ): (() => void) | undefined {
    const box = scrollerOf(list)
    this.box = box
    this.#list = list
    this.#rowOf = rowOf
    if (!box) return undefined

    const measure = () => {
      this.top = box.getBoundingClientRect().top - list.getBoundingClientRect().top
      this.room = box.clientHeight
    }

    this.row = rowOf(list)
    measure()

    const scrolled = () => {
      measure()
      onScroll?.(box)
    }

    const watch = new ResizeObserver(() => {
      this.row = rowOf(list)
      measure()
    })
    watch.observe(box)
    box.addEventListener('scroll', scrolled, { passive: true })

    return () => {
      watch.disconnect()
      box.removeEventListener('scroll', scrolled)
      this.#list = null
      this.#rowOf = null
      this.box = null
    }
  }
}
