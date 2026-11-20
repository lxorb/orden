import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { roving } from './roving'
import { segmented } from './slide'

let writes: string[] = []
const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'tabIndex')
beforeEach(() => {
  writes = []
  Object.defineProperty(HTMLElement.prototype, 'tabIndex', {
    configurable: true,
    get(this: HTMLElement) {
      return Number(this.getAttribute('tabindex') ?? -1)
    },
    set(this: HTMLElement, value: number) {
      writes.push(this.id)
      this.setAttribute('tabindex', String(value))
    },
  })
})
afterEach(() => {
  if (own) Object.defineProperty(HTMLElement.prototype, 'tabIndex', own)
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
function list(count: number, on: number) {
  const node = document.createElement('div')
  for (let at = 0; at < count; at++) {
    const row = document.createElement('button')
    row.className = at === on ? 'orden-row is-on' : 'orden-row'
    row.id = `r${at}`
    node.append(row)
  }
  document.body.append(node)
  return node
}
describe('a roving list told again (#2290)', () => {
  test('writes the tab stop only on the rows whose stop changes', () => {
    const node = list(100, 3)
    const moving = roving(node)
    writes = []
    moving.update?.({})
    expect(writes).toEqual([])
    node.querySelector('#r3')?.classList.remove('is-on')
    node.querySelector('#r50')?.classList.add('is-on')
    moving.update?.({})
    expect(writes.sort()).toEqual(['r3', 'r50'])
    expect(node.querySelector('#r50')?.getAttribute('tabindex')).toBe('0')
    expect(node.querySelector('#r3')?.getAttribute('tabindex')).toBe('-1')
    moving.destroy?.()
  })
})
describe('a segmented switch whose choice moves (#2290)', () => {
  test('measures its buttons in the next frame, not in the turn that moved the choice', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    const node = document.createElement('div')
    const [one, two] = ['a', 'b'].map((name) => {
      const button = document.createElement('button')
      button.textContent = name
      node.append(button)
      return button
    })
    one?.classList.add('on')
    document.body.append(node)
    const switched = segmented(node)
    let read = 0
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => {
        read++
        return 40
      },
    })
    try {
      one?.classList.remove('on')
      two?.classList.add('on')
      one?.classList.toggle('on', false)
      await Promise.resolve()
      await Promise.resolve()
      expect(read).toBe(0)
      for (const run of frames.splice(0)) run(0)
      expect(read).toBe(1)
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width)
      switched.destroy()
    }
  })
  test('and measures nothing in the turn it is mounted, placing its thumb in the next frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    let read = 0
    const left = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft')
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get: () => {
        read++
        return 12
      },
    })
    const node = document.createElement('div')
    for (const name of ['a', 'b']) {
      const button = document.createElement('button')
      button.textContent = name
      if (name === 'b') button.classList.add('on')
      node.append(button)
    }
    document.body.append(node)
    try {
      const switched = segmented(node)
      const thumb = node.querySelector<HTMLElement>('.orden-segmented-thumb')
      expect(read).toBe(0)
      expect(thumb?.style.opacity).toBe('0')
      for (const run of frames.splice(0)) run(0)
      expect(read).toBe(1)
      expect(thumb?.style.opacity).toBe('')
      expect(thumb?.style.transform).toBe('translate(12px, 0px)')
      switched.destroy()
    } finally {
      if (left) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', left)
    }
  })
})
