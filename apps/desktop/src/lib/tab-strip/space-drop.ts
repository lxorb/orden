import { listenOver } from '../drag-paths'
import { type Space, workspace } from '../workspace.svelte'
import { spacesOf, spacesOfPaths, toSpace } from './to-space'

export type Carried = { tab: string } | { paths: readonly string[] }

const ATTRIBUTE = 'data-space-drop'
const SWITCHER = 'switcher'
const LIST = '[data-spaces-open]'
const NEAR = 12
const CATCH = '.catch'
const LIT = 'is-drop'
const SPRING = 450

let over: HTMLElement | null = null
let sprung: HTMLElement | null = null
let opening: ReturnType<typeof setTimeout> | undefined

function underneath(point: { x: number; y: number }): Element | null {
  return document.elementsFromPoint(point.x, point.y).find((one) => !one.matches(CATCH)) ?? null
}

function nearList(point: { x: number; y: number }, button: HTMLElement): boolean {
  return [button, document.querySelector(LIST)].some((one) => {
    const box = one?.getBoundingClientRect()
    return (
      !!box &&
      point.x >= box.left - NEAR &&
      point.x <= box.right + NEAR &&
      point.y >= box.top - NEAR &&
      point.y <= box.bottom + NEAR
    )
  })
}

function spacesFor(carried: Carried): Space[] {
  if ('paths' in carried) return spacesOfPaths(carried.paths)
  const tab = workspace.tabs.find((one) => one.id === carried.tab)
  return tab ? spacesOf([tab]) : []
}

export function overSpaces(carried: Carried, point: { x: number; y: number } | null): boolean {
  const under = point ? underneath(point) : null
  const found = under?.closest<HTMLElement>(`[${ATTRIBUTE}]`) ?? null
  const said = found?.getAttribute(ATTRIBUTE)
  const lands = said === SWITCHER || spacesFor(carried).some((one) => one.id === said)
  light(found && lands ? found : null)

  if (sprung && !(point && nearList(point, sprung))) close()
  return over !== null && said !== SWITCHER
}

export function droppedOnSpace(carried: Carried): boolean {
  const space = over?.getAttribute(ATTRIBUTE) ?? null
  light(null)
  close()
  if (space === null || space === SWITCHER) return false

  if ('tab' in carried) {
    void toSpace([carried.tab], space)
    return true
  }
  const root = workspace.spaces.find((one) => one.id === space)?.root
  if (root === undefined) return false
  void workspace.moveMany([...carried.paths], root)
  return true
}

export function leftSpaces(): void {
  light(null)
  close()
}

let following: AbortController | null = null

export function followTreeDrag(paths: readonly string[]): void {
  following?.abort()
  const done = new AbortController()
  following = done
  const carried: Carried = { paths }
  const stop = () => {
    leftSpaces()
    done.abort()
  }
  const dragover = (event: DragEvent) => {
    if (!overSpaces(carried, { x: event.clientX, y: event.clientY })) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }
  const drop = (event: DragEvent) => {
    const landed = droppedOnSpace(carried)
    stop()
    if (!landed) return
    event.preventDefault()
    event.stopPropagation()
  }
  const options = { capture: true, signal: done.signal }
  listenOver(window, dragover, options)
  window.addEventListener('drop', drop, options)
  window.addEventListener('dragend', stop, options)
}

function light(element: HTMLElement | null) {
  if (element === over) return
  over?.classList.remove(LIT)
  element?.classList.add(LIT)
  over = element

  clearTimeout(opening)
  const button = element?.getAttribute(ATTRIBUTE) === SWITCHER ? element : null
  if (button && button.getAttribute('aria-expanded') !== 'true') {
    opening = setTimeout(() => {
      sprung = button
      button.click()
    }, SPRING)
  }
}

function close() {
  clearTimeout(opening)
  const button = sprung
  sprung = null
  if (button?.getAttribute('aria-expanded') === 'true') button.click()
}
