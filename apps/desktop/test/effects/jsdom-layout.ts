import { afterEach } from 'vitest'

class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

function letGoOfFocusIn(node: Node) {
  const held = document.activeElement
  if (held instanceof HTMLElement && held !== document.body && node.contains(held)) held.blur()
}

type Native = (this: Node, ...args: unknown[]) => unknown

function native(on: object, name: string): Native {
  return Object.getOwnPropertyDescriptor(on, name)?.value as Native
}

const remove = native(Element.prototype, 'remove')
const replaceWith = native(Element.prototype, 'replaceWith')
const replaceChildren = native(Element.prototype, 'replaceChildren')
const removeChild = native(Node.prototype, 'removeChild')
const replaceChild = native(Node.prototype, 'replaceChild')
const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')
const html = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')

Element.prototype.remove = function (this: Element) {
  letGoOfFocusIn(this)
  remove.call(this)
}
Element.prototype.replaceWith = function (this: Element, ...nodes: (Node | string)[]) {
  letGoOfFocusIn(this)
  replaceWith.apply(this, nodes)
}
Element.prototype.replaceChildren = function (this: Element, ...nodes: (Node | string)[]) {
  letGoOfFocusIn(this)
  replaceChildren.apply(this, nodes)
}
Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
  letGoOfFocusIn(child)
  return removeChild.call(this, child) as T
}
Node.prototype.replaceChild = function <T extends Node>(this: Node, node: Node, child: T): T {
  letGoOfFocusIn(child)
  return replaceChild.call(this, node, child) as T
}
Object.defineProperty(Node.prototype, 'textContent', {
  ...text,
  set(this: Node, value: string | null) {
    if (this instanceof Element) letGoOfFocusIn(this)
    text?.set?.call(this, value)
  },
})
Object.defineProperty(Element.prototype, 'innerHTML', {
  ...html,
  set(this: Element, value: string) {
    letGoOfFocusIn(this)
    html?.set?.call(this, value)
  },
})

const unfinished = new Set<() => void>()

Element.prototype.animate = function animate() {
  const played = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  const finish = () => {
    if (!unfinished.delete(finish)) return
    clearTimeout(timer)
    played.onfinish?.()
  }
  const timer = setTimeout(finish, 0)
  unfinished.add(finish)
  return played as unknown as Animation
}

const ROUNDS = 20

afterEach(() => {
  for (let round = 0; round < ROUNDS && unfinished.size; round++) {
    for (const finish of [...unfinished]) finish()
  }
})
