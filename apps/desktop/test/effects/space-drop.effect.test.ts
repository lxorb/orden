import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** A tab, or rows of the file list (#303), carried onto the space switcher: held over its
 *  button the list opens, a space's row lights and takes what is carried, and leaving the
 *  list - or Escape - closes what the hold opened, and nothing moves. See
 *  tab-strip/space-drop.ts. In the effects project for its document: the switcher here is
 *  its markup and nothing else, laid out along one line by the test, since jsdom lays out
 *  nothing - each element's box, and `elementsFromPoint`, are what the test says. */

const moved = vi.hoisted(() => [] as string[])

vi.mock('../../src/lib/tab-strip/to-space', () => ({
  spacesOf: () => [{ id: 'home' }, { id: 'uni' }],
  // Rows of Work may go Home, and not to Work.
  spacesOfPaths: () => [{ id: 'home' }],
  toSpace: (ids: string[], space: string) => {
    moved.push(`${ids.join()} to ${space}`)
    return Promise.resolve()
  },
}))

vi.mock('../../src/lib/workspace.svelte', () => ({
  workspace: {
    tabs: [{ id: 't1' }],
    spaces: [
      { id: 'home', root: '/home' },
      { id: 'work', root: '/work' },
    ],
    moveMany: (paths: string[], into: string) => {
      moved.push(`${paths.join()} into ${into}`)
      return Promise.resolve()
    },
  },
}))

const { droppedOnSpace, followTreeDrag, leftSpaces, overSpaces } =
  await import('../../src/lib/tab-strip/space-drop')

/** Where each element is, along one line: the button, a gap, the list with its rows and
 *  the space between two of them, and the pane well off to the side. */
const SPANS: Record<string, [number, number]> = {
  switcher: [0, 20],
  gap: [20, 36],
  list: [36, 200],
  work: [36, 100],
  between: [100, 110],
  home: [110, 160],
  pane: [400, 800],
}

/** The switcher's markup: its button, and once it is open, its list of rows and the
 *  catch an open list lays over the window (SpaceMenu.svelte). */
function switcher() {
  document.body.innerHTML = `
    <button id="switcher" data-space-drop="switcher" aria-expanded="false"></button>
    <p id="gap"></p>
    <div class="catch" id="catch" hidden></div>
    <div role="menu" id="list" data-spaces-open hidden>
      <button id="work" data-space-drop="work"></button>
      <p id="between"></p>
      <button id="home" data-space-drop="home"></button>
    </div>
    <main id="pane"></main>`
  const button = document.getElementById('switcher')!
  const list = document.getElementById('list')!
  const catcher = document.getElementById('catch')!
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true'
    button.setAttribute('aria-expanded', String(open))
    list.hidden = !open
    catcher.hidden = !open
  })
  for (const [id, [left, right]] of Object.entries(SPANS)) {
    const element = document.getElementById(id)
    if (element) {
      element.getBoundingClientRect = () =>
        ({ left, right, top: 0, bottom: 10, width: right - left, height: 10 }) as DOMRect
    }
  }
  return { button, list }
}

const byId = (id: string) => document.getElementById(id)
const pointOf = (id: string) => {
  const [left, right] = SPANS[id] ?? [0, 0]
  return { x: (left + right) / 2, y: 5 }
}
let under: Element | null = null
const over = (id: string | null, carried: Parameters<typeof overSpaces>[0] = TAB) => {
  under = id === null ? null : byId(id)
  return overSpaces(carried, id === null ? null : pointOf(id))
}

const TAB = { tab: 't1' }
const ROWS = { paths: ['/work/Plan.md', '/work/Trip'] }

beforeEach(() => {
  vi.useFakeTimers()
  moved.length = 0
  // The catch is over everything while the list is open, the button among the rest.
  document.elementsFromPoint = () => {
    const open = byId('catch')?.hidden === false
    return [...(open ? [byId('catch')!] : []), ...(under ? [under] : [])]
  }
})

afterEach(() => {
  leftSpaces()
  vi.useRealTimers()
})

describe('a tab held over the switcher', () => {
  test('lights the button, and opens the list after a moment', () => {
    const { button, list } = switcher()
    over('switcher')
    expect(button.classList.contains('is-drop')).toBe(true)
    expect(list.hidden).toBe(true)

    vi.advanceTimersByTime(500)
    expect(list.hidden).toBe(false)
  })

  test('passing over it opens nothing', () => {
    const { list } = switcher()
    over('switcher')
    vi.advanceTimersByTime(200)
    over('pane')
    vi.advanceTimersByTime(500)
    expect(list.hidden).toBe(true)
  })

  test('stays open over the button under the catch the open list lays over it', () => {
    const { list } = switcher()
    over('switcher')
    vi.advanceTimersByTime(500)
    over('switcher')
    vi.advanceTimersByTime(500)
    expect(list.hidden).toBe(false)
  })

  test('lights a space it may go to, and not the one it is in', () => {
    switcher()
    over('switcher')
    vi.advanceTimersByTime(500)

    over('work')
    expect(byId('work')?.classList.contains('is-drop')).toBe(false)
    over('home')
    expect(byId('home')?.classList.contains('is-drop')).toBe(true)
    expect(byId('switcher')?.classList.contains('is-drop')).toBe(false)
  })

  test('let go of on a space, moves there and closes the list', () => {
    const { list } = switcher()
    over('switcher')
    vi.advanceTimersByTime(500)
    over('home')

    expect(droppedOnSpace(TAB)).toBe(true)
    expect(moved).toEqual(['t1 to home'])
    expect(list.hidden).toBe(true)
    expect(byId('home')?.classList.contains('is-drop')).toBe(false)
  })

  test('from the button to the list, and between two rows, the list stays; off it, it closes', () => {
    const { list } = switcher()
    over('switcher')
    vi.advanceTimersByTime(500)
    over('gap')
    expect(list.hidden).toBe(false)
    over('between')
    expect(list.hidden).toBe(false)

    over('pane')
    expect(list.hidden).toBe(true)
  })

  test('let go of anywhere else, moves nothing', () => {
    switcher()
    over('switcher')
    expect(droppedOnSpace(TAB)).toBe(false)
    over(null)
    expect(droppedOnSpace(TAB)).toBe(false)
    expect(moved).toEqual([])
  })
})

describe('rows of the file list carried onto the switcher (#303)', () => {
  test('light only a space they may go to, and move there with the row’s move', () => {
    switcher()
    over('switcher', ROWS)
    vi.advanceTimersByTime(500)
    expect(over('work', ROWS)).toBe(false)
    expect(over('home', ROWS)).toBe(true)

    expect(droppedOnSpace(ROWS)).toBe(true)
    expect(moved).toEqual(['/work/Plan.md,/work/Trip into /home'])
  })
})

/** A drag the platform runs, as the window hears it. */
function dragged(type: string, id: string | null = null): Event {
  under = id === null ? null : byId(id)
  const event = new Event(type, { bubbles: true, cancelable: true })
  const { x, y } = id === null ? { x: 0, y: 0 } : pointOf(id)
  return Object.assign(event, { clientX: x, clientY: y, dataTransfer: { dropEffect: 'none' } })
}

describe('a pointer’s drag out of the file list', () => {
  test('is taken by a space’s row, and the drop is the switcher’s alone', () => {
    switcher()
    followTreeDrag(ROWS.paths)
    window.dispatchEvent(dragged('dragover', 'switcher'))
    vi.advanceTimersByTime(500)
    const over = dragged('dragover', 'home')
    window.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)

    const pane = vi.fn()
    byId('home')?.addEventListener('drop', pane)
    const drop = dragged('drop', 'home')
    byId('home')?.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
    expect(pane).not.toHaveBeenCalled()
    expect(moved).toEqual(['/work/Plan.md,/work/Trip into /home'])
  })

  test('is left alone over the file list, where its own drop is', () => {
    switcher()
    followTreeDrag(ROWS.paths)
    const over = dragged('dragover', 'pane')
    window.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(false)
    const drop = dragged('drop', 'pane')
    window.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
    expect(moved).toEqual([])
  })

  test('ended by Escape closes what the hold opened, moves nothing, and stops listening', () => {
    const { list } = switcher()
    followTreeDrag(ROWS.paths)
    window.dispatchEvent(dragged('dragover', 'switcher'))
    vi.advanceTimersByTime(500)
    window.dispatchEvent(dragged('dragover', 'home'))
    expect(list.hidden).toBe(false)

    // Escape cancels a drag the platform started; all the page hears is its end.
    window.dispatchEvent(dragged('dragend'))
    expect(list.hidden).toBe(true)
    expect(byId('home')?.classList.contains('is-drop')).toBe(false)

    const after = dragged('dragover', 'home')
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
    expect(moved).toEqual([])
  })

  test('of a row that moved is followed no more once the next drag starts', () => {
    // The row is gone from the list, and its `dragend` never reaches the window.
    switcher()
    followTreeDrag(['/work/Gone.md'])
    followTreeDrag(ROWS.paths)
    window.dispatchEvent(dragged('dragover', 'home'))
    window.dispatchEvent(dragged('drop', 'home'))
    expect(moved).toEqual(['/work/Plan.md,/work/Trip into /home'])
  })
})
