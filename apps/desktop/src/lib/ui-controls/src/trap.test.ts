import { afterEach, describe, expect, test, vi } from 'vitest'
import { trap } from './trap'

interface Fake {
  tagName: string
  isConnected: boolean
  tabIndex: number
  focused: number
  children: Fake[]
  focus(): void
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
  matches(selector: string): boolean
  getClientRects(): { length: number }[]
  contains(other: unknown): boolean
  querySelector(): Fake | null
  querySelectorAll(): Fake[]
  addEventListener(): void
  removeEventListener(): void
}

let active: Fake | null = null

function fake(tagName: string, children: Fake[] = []): Fake {
  const one: Fake = {
    tagName,
    isConnected: true,
    tabIndex: 0,
    focused: 0,
    children,
    focus() {
      one.focused += 1
      active = one
    },
    hasAttribute: () => false,
    getAttribute: () => null,
    matches: () => false,
    getClientRects: () => [{ length: 1 }],
    contains: (other) => other === one || children.some((child) => child.contains(other)),
    querySelector: () => null,
    querySelectorAll: () => children,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }

  return one
}

function page(rootSays?: string) {
  const body = fake('BODY')
  const root = fake('HTML')
  if (rootSays) root.hasAttribute = (name) => name === rootSays
  vi.stubGlobal('document', {
    get activeElement() {
      return active
    },
    body,
    documentElement: root,
  })
  vi.stubGlobal('HTMLElement', {
    [Symbol.hasInstance]: (value: unknown) =>
      typeof value === 'object' && value !== null && 'focus' in value,
  })
  return body
}

const layer = (children: Fake[] = []) => fake('DIV', children)
const open = (node: Fake) => trap(node as unknown as HTMLElement)

function openedFrom(rootSays?: string) {
  const body = page(rootSays)
  const opener = fake('BUTTON')
  opener.focus()
  const row = fake('BUTTON')
  return { body, opener, row, held: open(layer([row])) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  active = null
})

describe('the keyboard while a layer is open', () => {
  test('the first thing in the layer takes it, or the layer itself with nothing to stand on', () => {
    page()
    const row = fake('BUTTON')
    open(layer([row]))
    expect(row.focused).toBe(1)
    const node = layer()
    open(node)
    expect(node.focused).toBe(1)
  })

  test('under a thumb a menu keeps it itself, and a sheet still hands it on', () => {
    page('data-touch')
    const row = fake('BUTTON')
    const menu = layer([row])
    menu.matches = (selector) => selector.startsWith('.orden-host')
    open(menu)
    expect(menu.focused).toBe(1)
    expect(row.focused).toBe(0)
    const answer = fake('BUTTON')
    open(layer([answer]))
    expect(answer.focused).toBe(1)
  })
})

describe('the keyboard once the layer has gone', () => {
  test('goes back to what opened it', () => {
    const { opener, row, held } = openedFrom()
    expect(row.focused).toBe(1)
    held.destroy()
    expect(opener.focused).toBe(2)
  })

  test('goes back when the keyboard has fallen to the page', () => {
    const { body, opener, held } = openedFrom()
    active = body
    held.destroy()
    expect(opener.focused).toBe(2)
  })

  test('stays where something else has taken it', () => {
    const { opener, held } = openedFrom()
    const field = fake('INPUT')
    field.focus()
    held.destroy()
    expect(field.focused).toBe(1)
    expect(opener.focused).toBe(1)
    expect(active).toBe(field)
  })

  test("nothing of the app's own takes it back from a site that had it, nor to a row the layer deleted", () => {
    for (const [rootSays, gone] of [
      ['data-keyboard-in-page', false],
      [undefined, true],
    ] as const) {
      const { body, opener, held } = openedFrom(rootSays)
      opener.isConnected = !gone
      active = body
      held.destroy()
      expect(opener.focused).toBe(1)
    }
  })
})
