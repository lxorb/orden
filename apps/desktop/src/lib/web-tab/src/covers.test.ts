// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ALL,
  bringsLayer,
  cutOf,
  HELD,
  heldUntil,
  HOLDS_AT_MOST,
  layersOver,
  moving,
  noticeRows,
  settled,
  TRAIL,
  watchArrivals,
  type Cut,
  type Layer,
} from './covers'

const PAGE = { x: 300, y: 100, width: 900, height: 600 }
function float(x: number, y: number, width: number, height: number, radius = 8): Layer {
  return { box: { x, y, width, height }, radius, scrim: false }
}
const SCRIM: Layer = { box: { x: 0, y: 0, width: 1200, height: 800 }, radius: 0, scrim: true }
describe('what of a page the app is over', () => {
  test('nothing open is nothing over it', () => {
    expect(cutOf(PAGE, [])).toBeNull()
  })
  test('a menu over the file list leaves the page alone', () => {
    expect(cutOf(PAGE, [float(20, 200, 220, 300)])).toBeNull()
  })
  test("a tab's card over the strip and not the page leaves it alone", () => {
    expect(cutOf(PAGE, [float(320, 30, 256, 70)])).toBeNull()
  })
  test('a card hanging over the page is cut out of it, in the page’s own coordinates', () => {
    expect(cutOf(PAGE, [float(320, 30, 256, 216)])).toEqual({
      all: false,
      hollows: [{ x: 20, y: -70, width: 256, height: 216, radius: 8 }],
    })
  })
  test('each layer over the page is its own hollow', () => {
    const cut = cutOf(PAGE, [float(400, 120, 200, 300), float(620, 140, 180, 200), float(0, 0, 10, 10)])
    expect(cut?.all).toBe(false)
    expect(cut?.hollows).toHaveLength(2)
  })
  test('a scrim covers all of the page, and the sheet on it is still its own hollow', () => {
    const cut = cutOf(PAGE, [SCRIM, float(400, 150, 500, 400, 12)])
    expect(cut?.all).toBe(true)
    expect(cut?.hollows).toEqual([{ x: 100, y: 50, width: 500, height: 400, radius: 12 }])
  })
  test('a layer with no size yet is not over anything', () => {
    expect(cutOf(PAGE, [float(400, 120, 0, 0)])).toBeNull()
  })
  test('a layer only touching the edge of the page is not over it', () => {
    expect(cutOf(PAGE, [float(100, 100, 200, 100)])).toBeNull()
  })
})
describe("the notices row's cards", () => {
  function row(): { hole: HTMLElement; notices: HTMLElement; toast: HTMLElement } {
    document.body.innerHTML = `
      <div data-panes>
        <div class="hole"></div>
        <div class="notices" data-notices><div class="toast" role="status"><p>Deleted</p></div></div>
      </div>`
    const find = (selector: string) => document.querySelector<HTMLElement>(selector)!
    return { hole: find('.hole'), notices: find('[data-notices]'), toast: find('.toast') }
  }
  test('each card is a layer the page is cut round, and the row is not', () => {
    const { hole, notices, toast } = row()
    const found = layersOver(hole)
    expect(found.map((one) => one.node)).toEqual([toast])
    expect(found[0]?.scrim).toBe(false)
    expect(found.some((one) => one.node === notices)).toBe(false)
  })
  test('a layer hidden with what it stands in is no layer', () => {
    document.body.innerHTML = `
      <div class="hole"></div>
      <div class="column" style="visibility: hidden"><div class="orden-bubble hint"></div></div>
      <div class="orden-layer"></div>`
    const hidden = document.querySelector('.hint')!
    const drawn = document.querySelector('.orden-layer')!
    const visible = (one: Element) => one !== hidden
    for (const one of [hidden, drawn]) Object.assign(one, { checkVisibility: () => visible(one) })
    const found = layersOver(document.querySelector<HTMLElement>('.hole')!)
    expect(found.map((one) => one.node)).toEqual([drawn])
  })
  test('the row is what a page watches to hear a card come or go', () => {
    const { notices } = row()
    expect(noticeRows()).toEqual([notices])
  })
})
describe("a swipe's arrow over a page", () => {
  function swipe(stage: 'tracking' | 'went'): HTMLElement {
    document.body.innerHTML = `
      <div class="hole"></div>
      <div class="track ${stage === 'went' ? '' : 'orden-swipe-room'}"><div class="orden-swipe"></div></div>`
    return document.querySelector<HTMLElement>('.hole')!
  }
  test('while the fingers are on, its room covers the page, and the circle is a layer', () => {
    const found = layersOver(swipe('tracking'))
    expect(found.map((one) => one.scrim)).toEqual([true, false])
    expect(found.find((one) => one.scrim)?.node?.classList.contains('track')).toBe(true)
  })
  test('bursting on its way out, it is the circle alone', () => {
    const found = layersOver(swipe('went'))
    expect(found.map((one) => one.scrim)).toEqual([false])
  })
})
describe('a page over the notices', () => {
  test('keeps its whole box and is cut round each card alone', () => {
    const cut = cutOf(PAGE, [float(850, 640, 330, 52), float(600, 620.6, 200, 72)])
    expect(cut?.all).toBe(false)
    expect(cut?.hollows).toEqual([
      { x: 550, y: 540, width: 330, height: 52, radius: 8 },
      { x: 300, y: 520.6, width: 200, height: 72, radius: 8 },
    ])
  })
})
describe('a layer arriving by itself', () => {
  function record(target: Node, added: Node[] = [], removed: Node[] = []) {
    const list = (nodes: Node[]) => nodes as unknown as NodeList
    return { target, addedNodes: list(added), removedNodes: list(removed) }
  }
  test('is heard as it comes, and as it goes', () => {
    document.body.innerHTML = '<div class="orden-layer"></div><p>words</p>'
    const layer = document.querySelector('.orden-layer')!
    const words = document.querySelector('p')!
    expect(bringsLayer(record(document.body, [layer]))).toBe(true)
    expect(bringsLayer(record(document.body, [], [layer]))).toBe(true)
    expect(bringsLayer(record(document.body, [words, document.createTextNode('x')]))).toBe(false)
  })
  test('inside whatever brought it', () => {
    document.body.innerHTML = '<section><div><span class="orden-bubble"></span></div></section>'
    expect(bringsLayer(record(document.body, [document.querySelector('section')!]))).toBe(true)
  })
  test('and any card in the notices row, which once taken out is in no row', () => {
    document.body.innerHTML = '<div data-notices></div>'
    const card = document.createElement('div')
    expect(bringsLayer(record(document.querySelector('[data-notices]')!, [], [card]))).toBe(true)
  })
  test('a layer marked rather than shaped is one, in its own shape or over all of the page', () => {
    document.body.innerHTML = '<div data-covers class="ghost"></div><div data-covers="all" class="catch"></div>'
    const found = layersOver(document.createElement('div'))
    expect(found.map((one) => one.scrim)).toEqual([false, true])
  })
  test('and as one is shown, hidden or moved in place, or what holds one is', () => {
    document.body.innerHTML =
      '<div class="bar" data-covers></div><section><span class="orden-bubble"></span></section><p></p>'
    const changed = (target: Node) => ({ ...record(target), type: 'attributes' as const })
    expect(bringsLayer(changed(document.querySelector('.bar')!))).toBe(true)
    expect(bringsLayer(changed(document.querySelector('section')!))).toBe(true)
    expect(bringsLayer(changed(document.querySelector('p')!))).toBe(false)
  })
  test('a layer shown by its style is heard before the next frame', async () => {
    document.body.innerHTML = '<div class="orden-scrim" style="visibility: hidden"></div><p></p>'
    let heard = 0
    const stop = watchArrivals(() => (heard += 1))
    document.querySelector<HTMLElement>('.orden-scrim')!.style.visibility = ''
    await Promise.resolve()
    expect(heard).toBe(1)
    document.querySelector('p')!.setAttribute('style', 'color: red')
    await Promise.resolve()
    expect(heard).toBe(1)
    stop()
  })
  test('every page is told, by one watch on the window', async () => {
    document.body.innerHTML = '<main></main>'
    let one = 0
    let other = 0
    const stopOne = watchArrivals(() => (one += 1))
    const stopOther = watchArrivals(() => (other += 1))
    document.querySelector('main')!.append(Object.assign(document.createElement('div'), { className: 'orden-screen' }))
    await Promise.resolve()
    expect([one, other]).toEqual([1, 1])
    document.querySelector('main')!.append(document.createElement('p'))
    await Promise.resolve()
    expect([one, other]).toEqual([1, 1])
    stopOne()
    document.querySelector('.orden-screen')!.remove()
    await Promise.resolve()
    expect([one, other]).toEqual([1, 2])
    stopOther()
    document.querySelector('main')!.append(Object.assign(document.createElement('div'), { className: 'orden-layer' }))
    await Promise.resolve()
    expect([one, other]).toEqual([1, 2])
  })
})
describe('what is told of a cut', () => {
  const arrow = (x: number): Cut => ({
    all: true,
    hollows: [{ x, y: 100, width: 40, height: 40, radius: 20 }],
  })
  test('is the same for every step of an arrow over a page standing as its picture', () => {
    expect(settled(arrow(10), true, true)).toEqual(settled(arrow(30), true, true))
    expect(settled(arrow(10), true, true)).toEqual(ALL)
  })
  test('cuts round the arrow while there is no picture yet, on an engine that cuts', () => {
    expect(settled(arrow(10), false, true)).toEqual(arrow(10))
  })
  test('is all of the page on an engine that cannot cut', () => {
    expect(settled(arrow(10), false, false)).toEqual(ALL)
  })
  test('leaves a menu over a page that is not hidden alone', () => {
    const menu: Cut = { all: false, hollows: [{ x: 1, y: 2, width: 3, height: 4, radius: 5 }] }
    expect(settled(menu, true, true)).toBe(menu)
    expect(settled(null, true, true)).toBeNull()
  })
})
describe('a layer going', () => {
  const changed = (target: Node, attributeName: string, oldValue: string | null) => ({
    target,
    addedNodes: [] as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
    type: 'attributes' as const,
    attributeName,
    oldValue,
  })
  test('is heard as its mark comes off, so the page takes back its place', () => {
    document.body.innerHTML = '<aside class="side"></aside><p class="words"></p>'
    const side = document.querySelector('aside')!
    expect(bringsLayer(changed(side, 'data-covers', ''))).toBe(true)
    expect(bringsLayer(changed(side, 'class', 'side orden-layer'))).toBe(true)
    expect(bringsLayer(changed(document.querySelector('p')!, 'class', 'words old'))).toBe(false)
  })
})
describe('a layer on its way in', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'getAnimations')
  })
  function sliding(from: number, to: number) {
    document.body.innerHTML = '<div class="hole"></div><aside data-covers></aside>'
    const hole = document.querySelector<HTMLElement>('.hole')!
    const side = document.querySelector('aside')!
    let ended = false
    const box = (x: number) => ({ x, y: 6, width: 280, height: 700, top: 6, left: x, right: x + 280, bottom: 706 })
    side.getBoundingClientRect = () => box(ended ? to : from) as DOMRect
    hole.getBoundingClientRect = () => box(0) as DOMRect
    const slide = {
      playState: 'running',
      playbackRate: 1,
      effect: {
        target: side,
        pseudoElement: null,
        getComputedTiming: () => ({ endTime: 130 }),
        getKeyframes: () => [
          { offset: 0, transform: `translateX(${from - to}px)` },
          { offset: 1, easing: 'ease-out', transform: 'none' },
        ],
      },
    }
    const asked: Keyframe[][] = []
    side.animate = ((frames: Keyframe[]) => {
      asked.push(frames)
      ended = true
      return { cancel: () => (ended = false) }
    }) as unknown as typeof side.animate
    Object.defineProperty(document, 'getAnimations', {
      value: () => [slide as unknown as Animation],
      configurable: true,
    })
    return { hole, side, asked, ended: () => ended }
  }
  test('is cut where it comes to rest, from its first frame, and not a frame behind its slide', () => {
    const { hole, asked, ended } = sliding(-290, 6)
    const [found] = layersOver(hole)
    expect(found?.box).toEqual({ x: -290, y: 6, width: 576, height: 700 })
    expect(asked).toEqual([[{ transform: 'none' }]])
    expect(ended()).toBe(false)
    expect(moving(hole)).toBe(true)
  })
  test('keeps whatever it covers at each step on its way out', () => {
    const { hole } = sliding(6, -290)
    expect(layersOver(hole)[0]?.box).toEqual({ x: -290, y: 6, width: 576, height: 700 })
  })
})
describe('a layer arriving over a page', () => {
  afterEach(() => vi.useRealTimers())
  const tick = () => new Promise<void>((go) => setTimeout(go, 0))
  test('is held unseen until the page has been cut round it, so no frame shows the page over it', async () => {
    document.body.innerHTML = '<main></main>'
    let placed: () => void = () => undefined
    const stop = watchArrivals(() => heldUntil(new Promise<void>((go) => (placed = go))))
    const menu = Object.assign(document.createElement('div'), { className: 'orden-layer' })
    document.querySelector('main')!.append(menu)
    await Promise.resolve()
    expect(menu.hasAttribute(HELD)).toBe(true)
    expect(document.getElementById(HELD)?.textContent).toContain('clip-path')
    placed()
    await tick()
    expect(menu.hasAttribute(HELD)).toBe(false)
    stop()
  })
  test('is held as it comes, and not again as it moves or changes while shown', async () => {
    document.body.innerHTML = '<main></main>'
    let placed: () => void = () => undefined
    const stop = watchArrivals(() => heldUntil(new Promise<void>((go) => (placed = go))))
    const ghost = Object.assign(document.createElement('div'), { className: 'ghost' })
    ghost.dataset.covers = ''
    Object.assign(ghost, { checkVisibility: () => !ghost.hidden })
    document.querySelector('main')!.append(ghost)
    await Promise.resolve()
    expect(ghost.hasAttribute(HELD)).toBe(true)
    placed()
    await tick()
    ghost.style.left = '40px'
    await Promise.resolve()
    expect(ghost.hasAttribute(HELD)).toBe(false)
    ghost.hidden = true
    await Promise.resolve()
    ghost.hidden = false
    await Promise.resolve()
    expect(ghost.hasAttribute(HELD)).toBe(true)
    placed()
    await tick()
    ghost.remove()
    await Promise.resolve()
    document.querySelector('main')!.append(ghost)
    await Promise.resolve()
    expect(ghost.hasAttribute(HELD)).toBe(true)
    placed()
    await tick()
    stop()
  })
  test('is shown at once when no page had to move for it', async () => {
    document.body.innerHTML = '<main></main>'
    const stop = watchArrivals(() => undefined)
    const menu = Object.assign(document.createElement('div'), { className: 'orden-layer' })
    document.querySelector('main')!.append(menu)
    await Promise.resolve()
    expect(menu.hasAttribute(HELD)).toBe(false)
    stop()
  })
  test('is never held longer than a page takes to answer at most', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<main></main>'
    const stop = watchArrivals(() => heldUntil(new Promise<void>(() => undefined)))
    const side = document.createElement('aside')
    document.querySelector('main')!.append(side)
    side.setAttribute('data-covers', '')
    await Promise.resolve()
    expect(side.hasAttribute(HELD)).toBe(true)
    await vi.advanceTimersByTimeAsync(HOLDS_AT_MOST)
    expect(side.hasAttribute(HELD)).toBe(false)
    stop()
  })
})
describe('a layer on the move', () => {
  afterEach(() => vi.restoreAllMocks())
  test('keeps the page cut where it was a moment ago too, as long as the screen may still show it there', () => {
    document.body.innerHTML = '<div class="hole"></div><div class="ghost" data-covers></div>'
    const hole = document.querySelector<HTMLElement>('.hole')!
    const ghost = document.querySelector('.ghost')!
    let x = 100
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    ghost.getBoundingClientRect = () => ({ x, y: 50, width: 40, height: 40 }) as DOMRect
    expect(layersOver(hole)[0]?.box).toEqual({ x: 100, y: 50, width: 40, height: 40 })
    expect(moving(hole)).toBe(false)
    now += 16
    x = 160
    expect(layersOver(hole)[0]?.box).toEqual({ x: 100, y: 50, width: 100, height: 40 })
    expect(moving(hole)).toBe(true)
    now += TRAIL
    expect(layersOver(hole)[0]?.box).toEqual({ x: 160, y: 50, width: 40, height: 40 })
    now += TRAIL
    expect(moving(hole)).toBe(false)
  })
})
