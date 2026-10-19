import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { CoverWidget } from '../src/live-preview/cover'

/** A click under a note's cover lands on the line it was made on.
 *
 *  CodeMirror finds the line under a click from the heights it measured, and it
 *  measures a block by its border box. The band's room below it is a margin
 *  (document.css), outside that box, so when the band itself was the block every
 *  line under it sat that margin lower on the screen than CodeMirror had it, and a
 *  click on a word put the caret on the empty line below. So the band is handed to
 *  the editor inside a block that holds its margin, and that block tells the editor
 *  to measure again whenever its height changes by itself - a picture arriving
 *  late, the text size under an `em`. The clicks are cover-click.py's; this is the
 *  shape that makes them land.
 *
 *  No DOM: the widget only makes elements, appends them and names them, so a
 *  stand-in that remembers that much is the whole of what is read. */

interface StandIn {
  tag: string
  className: string
  children: StandIn[]
  style: Record<string, string>
  append(...children: StandIn[]): void
  setAttribute(): void
  addEventListener(): void
  removeEventListener(): void
}

function standIn(tag: string): StandIn {
  return {
    tag,
    className: '',
    children: [],
    style: {},
    append(...children) {
      this.children.push(...children)
    },
    setAttribute() {
      return undefined
    },
    addEventListener() {
      return undefined
    },
    removeEventListener() {
      return undefined
    },
  }
}

/** Every resize observer the widget makes: what it watches, whether it was let go,
 *  and a way to say the watched box changed size. */
const observers: { watched: unknown[]; disconnected: boolean; resize: () => void }[] = []

class Observer {
  private readonly own: (typeof observers)[number]

  constructor(callback: () => void) {
    this.own = { watched: [], disconnected: false, resize: callback }
    observers.push(this.own)
  }

  observe(target: unknown) {
    this.own.watched.push(target)
  }

  disconnect() {
    this.own.disconnected = true
  }
}

vi.stubGlobal('document', { createElement: standIn })
vi.stubGlobal('ResizeObserver', Observer)

afterEach(() => {
  observers.length = 0
})

function drawn() {
  const requestMeasure = vi.fn()
  const view = {
    state: { facet: () => (src: string) => src },
    requestMeasure,
  } as unknown as EditorView
  const widget = new CoverWidget({ src: 'assets/sky.png', position: 50 })
  // The widget builds its elements through the stand-in `document` above.
  const block = widget.toDOM(view) as unknown as StandIn
  return { widget, block, requestMeasure }
}

describe("a note's cover in the editor", () => {
  test('is a block holding the band, not the band itself', () => {
    const { block } = drawn()
    expect(block.className).toBe('nib-cover-block')
    expect(block.children.map((one) => one.className)).toEqual(['nib-cover'])
    expect(block.children[0]?.children.map((one) => one.tag)).toEqual(['img', 'div'])
  })

  test('has the editor measure again when its height changes by itself', () => {
    const { block, requestMeasure } = drawn()
    const [observer] = observers
    expect(observer?.watched).toEqual([block])

    observer?.resize()
    expect(requestMeasure).toHaveBeenCalledTimes(1)
  })

  test('stops watching once the editor lets it go', () => {
    const { widget, block } = drawn()
    widget.destroy(block as unknown as HTMLElement)
    expect(observers[0]?.disconnected).toBe(true)
  })
})

describe("the cover's stylesheets", () => {
  const sheet = (name: string) =>
    readFileSync(
      fileURLToPath(new URL(`../../themes/src/${name}`, import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')

  /** The declarations under exactly this selector. */
  function body(css: string, selector: string): string {
    const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      (match) => (match[1] ?? '').trim() === selector,
    )
    return found.map((match) => match[2] ?? '').join(';')
  }

  test('give the band a margin below it, which is what the block has to hold', () => {
    expect(body(sheet('document.css'), '#write .nib-cover')).toMatch(/\bmargin\s*:/)
  })

  test('make the block hold its margins inside the box the editor measures', () => {
    const block = body(sheet('editor.css'), '#write .nib-cover-block')
    expect(block).toMatch(/\bdisplay\s*:\s*flow-root\b/)
    expect(block).not.toMatch(/\bmargin/)
  })
})
