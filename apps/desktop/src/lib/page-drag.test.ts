import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'

const script = readFileSync(new URL('../../src-tauri/src/page_drag.js', import.meta.url), 'utf8')

function page(html = '') {
  const dom = new JSDOM(
    `<div id="row" draggable="true"><span id="inner"></span>row</div><div id="folder">folder</div><div id="other" draggable="true">other</div><input id="field"><div id="note" contenteditable="true"></div>${html}`,
    { runScripts: 'outside-only' },
  )
  const inside = dom.window as unknown as Window & typeof globalThis
  const { document } = inside

  class Transfer {
    kept = new Map<string, string>()
    get types() {
      return [...this.kept.keys()]
    }
    setData(type: string, value: string) {
      this.kept.set(type, value)
    }
    getData(type: string) {
      return this.kept.get(type) ?? ''
    }
  }
  class Drag extends inside.MouseEvent {
    dataTransfer: unknown
    native = false
    constructor(type: string, init: MouseEventInit & { dataTransfer?: unknown }) {
      super(type, init)
      this.dataTransfer = init.dataTransfer
    }
  }
  class Pointer extends inside.MouseEvent {
    pointerId: number
    constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
    }
  }
  Object.assign(inside, { DragEvent: Drag, PointerEvent: Pointer, DataTransfer: Transfer })

  let under: Element | null = null
  document.elementFromPoint = () => under
  let atRest: (() => void) | null = null
  inside.setInterval = ((run: () => void) => {
    atRest = run
    return 1
  }) as typeof inside.setInterval
  inside.clearInterval = () => {
    atRest = null
  }

  inside.eval(script.replaceAll('!event.isTrusted', '!event.native'))

  const heard: string[] = []
  for (const type of ['dragstart', 'dragenter', 'dragover', 'dragleave', 'drop', 'dragend']) {
    inside.addEventListener(type, (event) => {
      heard.push(`${type} ${(event.target as Element).id}`)
    })
  }
  const byId = (id: string) => document.getElementById(id)!
  for (const type of ['dragenter', 'dragover']) {
    byId('folder').addEventListener(type, (event) => {
      event.preventDefault()
      ;(event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect =
        'move'
    })
  }

  const pointer = (type: string, init: MouseEventInit & { pointerId?: number } = {}) => {
    const event = new Pointer(type, {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      ...init,
    })
    byId('row').dispatchEvent(event)
    return event
  }
  const start = (id = 'row', effect?: string, data?: Record<string, string>) => {
    const transfer = new Transfer()
    for (const [type, value] of Object.entries(data ?? {})) transfer.setData(type, value)
    const event = new Drag('dragstart', {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      dataTransfer: transfer,
    })
    event.native = true
    if (effect) {
      byId(id).addEventListener(
        'dragstart',
        (one) => {
          ;(
            one as unknown as { dataTransfer: { effectAllowed: string } }
          ).dataTransfer.effectAllowed = effect
        },
        { once: true },
      )
    }
    byId(id).dispatchEvent(event)
    return event
  }
  const over = (id: string, x = 20) => {
    under = byId(id)
    pointer('pointermove', { clientX: x, clientY: 20 })
  }
  return {
    inside,
    heard,
    byId,
    pointer,
    start,
    over,
    tick: () => atRest?.(),
    live: () => atRest !== null,
    count: (name: string) => heard.filter((one) => one.startsWith(`${name} `)).length,
  }
}

describe('a drag let go', () => {
  test('lands on what took it, once, and swallows the click', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    it.pointer('pointerup', { clientX: 20, clientY: 20 })
    expect(it.heard).toContain('drop folder')
    expect(it.count('drop')).toBe(1)
    expect(it.heard.at(-1)).toBe('dragend row')
    expect(it.live()).toBe(false)
  })

  test('on a row that did not take it lands nowhere', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('other')
    it.pointer('pointerup', { clientX: 20, clientY: 20 })
    expect(it.count('drop')).toBe(0)
    expect(it.heard.at(-1)).toBe('dragend row')
  })
})

describe('a drag that has lost its pointer never lands', () => {
  test('the window losing the focus ends it', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    it.inside.document.hasFocus = () => false
    it.inside.dispatchEvent(new it.inside.Event('blur'))
    expect(it.live()).toBe(false)
    expect(it.heard.at(-1)).toBe('dragend row')
    const seen = it.count('dragover')
    it.tick()
    expect(it.count('dragover')).toBe(seen)
    it.pointer('pointerup', { clientX: 20, clientY: 20 })
    expect(it.count('drop')).toBe(0)
  })

  test('a focus moving inside the page does not', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    it.byId('field').dispatchEvent(new it.inside.FocusEvent('blur'))
    expect(it.live()).toBe(true)
  })

  test('the page being hidden ends it', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    Object.defineProperty(it.inside.document, 'visibilityState', { value: 'hidden' })
    it.inside.document.dispatchEvent(new it.inside.Event('visibilitychange'))
    expect(it.live()).toBe(false)
    expect(it.count('drop')).toBe(0)
  })

  test('a new press ends it, and is the page’s own', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    const press = it.pointer('pointerdown', { clientX: 20, clientY: 20 })
    expect(it.live()).toBe(false)
    expect(it.count('drop')).toBe(0)
    expect(press.defaultPrevented).toBe(false)
  })

  test('a release somewhere the drag never was does not land', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    it.pointer('pointerup', { clientX: 400, clientY: 300 })
    expect(it.count('drop')).toBe(0)
    expect(it.live()).toBe(false)
  })

  test('a release with the left button still down does not land or end it', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    it.pointer('pointerup', { clientX: 20, clientY: 20, button: 2, buttons: 1 })
    expect(it.count('drop')).toBe(0)
    expect(it.live()).toBe(true)
  })

  test('a release of another button with none down does not land', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    it.pointer('pointerup', { clientX: 20, clientY: 20, button: 2, buttons: 0 })
    expect(it.count('drop')).toBe(0)
    expect(it.live()).toBe(false)
  })

  test('a move with the left button no longer down ends it', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    it.pointer('pointermove', { clientX: 20, clientY: 20, buttons: 2 })
    expect(it.live()).toBe(false)
    expect(it.count('drop')).toBe(0)
  })
})

describe('a drag starting while another is live', () => {
  test('ends the old one and takes the new from the engine', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    const second = it.start('other', 'copyMove')
    expect(it.heard).toContain('dragend row')
    expect(it.count('drop')).toBe(0)
    expect(second.defaultPrevented).toBe(true)
    expect(it.heard).toContain('dragstart other')
    expect(it.live()).toBe(true)
  })
})

describe('words dragged', () => {
  const WORDS = { 'text/plain': 'some words' }

  test('over a field are refused, as nothing would put them in', () => {
    const it = page()
    it.start('row', 'copyMove', WORDS)
    it.over('field')
    it.pointer('pointerup', { clientX: 20, clientY: 20 })
    expect(it.count('drop')).toBe(0)
  })

  test('over a note land, for the editor to take', () => {
    const it = page()
    it.start('row', 'copyMove', WORDS)
    it.over('note')
    it.pointer('pointerup', { clientX: 20, clientY: 20 })
    expect(it.heard).toContain('drop note')
  })
})

describe('around the drag', () => {
  test('a press held on the row is cancelled by its own id', () => {
    const it = page()
    const said: number[] = []
    it.byId('row').addEventListener('pointercancel', (event) => {
      said.push(event.pointerId)
    })
    it.pointer('pointerdown', { pointerId: 7 })
    it.start('row', 'copyMove')
    expect(said).toEqual([7])
  })

  test('another button’s press and menu go nowhere', () => {
    const it = page()
    it.start('row', 'copyMove')
    it.over('folder')
    for (const type of ['mousedown', 'contextmenu']) {
      const heard: string[] = []
      it.byId('folder').addEventListener(type, () => heard.push(type))
      it.byId('folder').dispatchEvent(
        new it.inside.MouseEvent(type, { bubbles: true, cancelable: true, button: 2, buttons: 3 }),
      )
      expect(heard).toEqual([])
    }
  })

  test('what is carried has no ids, frames or players of its own', () => {
    const it = page(
      '<div id="rich" draggable="true"><span id="deep">x</span><iframe id="f"></iframe><video id="v"></video></div>',
    )
    it.start('rich', 'copyMove')
    const carried = it.inside.document.documentElement.lastElementChild as HTMLElement
    expect(carried.id).toBe('')
    expect(carried.querySelectorAll('[id]').length).toBe(0)
    expect(carried.querySelectorAll('iframe, video').length).toBe(0)
  })
})
