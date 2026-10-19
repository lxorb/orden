/** A tab, or rows of the file list, carried onto a space in the switcher: held over the
 *  switcher's button it opens the list, as macOS opens a folder under a file held over it,
 *  and let go of on a space's row it moves there - Arc's tab dropped on a space's icon. The
 *  row lights as the file list's does under a drop. Leaving the list, or Escape, closes
 *  what the hold opened, and nothing moves.
 *
 *  A row of the file list moves the way its Move did (#303): `moveMany` into the space's
 *  root, the same move and the same Undo. A tab moves as Move to space moves it
 *  (moving-space.ts), the file with it.
 *
 *  The switcher itself only says which element is which (`data-space-drop`) and how a lit
 *  one looks; everything else is here, fetched with the drag, so nothing of it is in front
 *  of the first paint. See SpaceSwitcher.svelte, carrying.ts for a tab, and Tree.svelte
 *  and tree-lift.ts for rows - a pointer's drag and a finger's lift. */

import { type Space, workspace } from '../workspace.svelte'
import { spacesOf, spacesOfPaths, toSpace } from './to-space'

/** What is being carried: a tab of a strip, or rows of the file list by their paths. */
export type Carried = { tab: string } | { paths: readonly string[] }

const ATTRIBUTE = 'data-space-drop'
/** What the switcher's own button says, where a row says its space's id. */
const SWITCHER = 'switcher'
/** The list of spaces, open. */
const LIST = '[data-spaces-open]'
/** How far off the button or the list a carried thing may stray and keep it open, in
 *  px: about the gap between the two. */
const NEAR = 12
/** What a list that is open lays over the window, and is never what is carried onto. */
const CATCH = '.catch'
/** The class a lit button or row wears. */
const LIT = 'is-drop'
/** How long a tab is held over the button before the list opens: about what macOS waits
 *  before it opens a folder under a held file. */
const SPRING = 450

/** What the tab is over now, lit. */
let over: HTMLElement | null = null
/** The button whose list the hold opened, to close again. */
let sprung: HTMLElement | null = null
let opening: ReturnType<typeof setTimeout> | undefined

/** What is at a point, looking through the catch an open list lays over the window to
 *  take a press past it (SpaceMenu.svelte): it covers the switcher's button too, and
 *  the button under it read as nothing - the hold's list closed as it opened, and opened
 *  again, and nothing could be let go of on a space. */
function underneath(point: { x: number; y: number }): Element | null {
  return document.elementsFromPoint(point.x, point.y).find((one) => !one.matches(CATCH)) ?? null
}

/** Whether a point is on the switcher's button or its open list, or within a step of
 *  either. */
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

/** The spaces what is carried may go to. */
function spacesFor(carried: Carried): Space[] {
  if ('paths' in carried) return spacesOfPaths(carried.paths)
  const tab = workspace.tabs.find((one) => one.id === carried.tab)
  return tab ? spacesOf([tab]) : []
}

/** What is carried is at `point`, or over nothing of the switcher's where that is null.
 *  Answers whether it is over a space's row it would land in. */
export function overSpaces(carried: Carried, point: { x: number; y: number } | null): boolean {
  const under = point ? underneath(point) : null
  const found = under?.closest<HTMLElement>(`[${ATTRIBUTE}]`) ?? null
  const said = found?.getAttribute(ATTRIBUTE)
  const lands = said === SWITCHER || spacesFor(carried).some((one) => one.id === said)
  light(found && lands ? found : null)

  // Out of the list the hold opened, and off its button: it closes again. The gap
  // between the two is neither, and the way from one to the other.
  if (sprung && !(point && nearList(point, sprung))) close()
  return over !== null && said !== SWITCHER
}

/** Let go of: moved to the space whose row is lit. Answers whether it was. */
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

/** The carrying ended without landing anywhere: Escape, or let go of over nothing. */
export function leftSpaces(): void {
  light(null)
  close()
}

/** The drag out of the file list being followed, to stop following. */
let following: AbortController | null = null

/** Rows of the file list dragged by a pointer: the platform's drag, followed over the
 *  window until it ends. Captured, so a drop on a space's row is the switcher's and not
 *  whatever holds the switcher - the sidebar takes files dropped on it. Escape ends a
 *  drag the platform started with `dragend`, which is the end of this too. A drop ends
 *  it as well, and so does the next drag: a row that moved is a row the list no longer
 *  draws, and the `dragend` of one taken out of the page never reaches the window. */
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
  window.addEventListener('dragover', dragover, options)
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

/** The list the hold opened, closed by the button that opened it. */
function close() {
  clearTimeout(opening)
  const button = sprung
  sprung = null
  if (button?.getAttribute('aria-expanded') === 'true') button.click()
}
