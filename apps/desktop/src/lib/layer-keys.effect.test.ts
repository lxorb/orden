import { afterEach, describe, expect, test } from 'vitest'

const { keyElsewhere } = await import('./layer-keys')

afterEach(() => {
  document.body.replaceChildren()
})

function press(on: Element, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
  })
  on.dispatchEvent(event)
  return event
}

function built(html: string) {
  document.body.innerHTML = html
  const at = (selector: string) => {
    const found = document.querySelector(selector)
    if (!found) throw new Error(selector)
    return found
  }
  return at
}

function struck(on: Element, key: string, held: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held })
  on.dispatchEvent(event)
  return event
}

function reached(on: Element, byKeys: boolean) {
  const own = on.matches.bind(on)
  on.matches = (selector: string) => (selector === ':focus-visible' ? byKeys : own(selector))
}

describe('a key pressed on a control in a view', () => {
  const asked = (host: Element, node: Element, key: string, held?: Partial<KeyboardEventInit>) => {
    let elsewhere = false
    host.addEventListener('keydown', (event) => (elsewhere = keyElsewhere(event, host)), {
      once: true,
    })
    struck(node, key, held)
    return elsewhere
  }

  test('is the control’s when reached by keys: it presses, steps or leaves it, nothing else', () => {
    const at = built(`
      <div class="host"><button class="bar"></button><a class="link" href="#"></a>
        <div role="tablist"><span class="tab" role="tab" tabindex="0"></span></div>
        <span class="row"></span></div>`)
    const host = at('.host')
    for (const node of [at('.bar'), at('.link'), at('.tab')]) reached(node, true)
    for (const key of [' ', 'Enter', 'Delete', 'Backspace', 'Tab']) {
      expect(asked(host, at('.bar'), key)).toBe(true)
    }
    expect(asked(host, at('.bar'), 'Delete', { shiftKey: true })).toBe(true)
    expect(asked(host, at('.link'), 'Enter')).toBe(true)
    expect(asked(host, at('.tab'), 'ArrowRight')).toBe(true)
    expect(asked(host, at('.bar'), 'ArrowRight')).toBe(false)
    expect(asked(host, at('.bar'), 'v')).toBe(false)
    expect(asked(host, at('.bar'), 'Escape')).toBe(false)
    expect(asked(host, at('.bar'), 'z', { ctrlKey: true })).toBe(false)
    expect(asked(host, at('.row'), ' ')).toBe(false)
  })

  test('is the view’s when the control was clicked, is the view’s own item, or is the view', () => {
    const at = built(`
      <div class="host" role="button" tabindex="0"><button class="bar"></button>
        <button class="row" role="listitem" data-item="a"></button>
        <div class="card" data-card role="button" tabindex="0"></div></div>
      <button class="out"></button>`)
    const host = at('.host')
    reached(host, true)
    reached(at('.bar'), false)
    reached(at('.row'), true)
    reached(at('.card'), true)
    reached(at('.out'), true)
    expect(asked(host, at('.bar'), ' ')).toBe(false)
    expect(asked(host, at('.row'), 'Delete')).toBe(false)
    expect(asked(host, at('.card'), ' ')).toBe(false)
    expect(asked(host, host, ' ')).toBe(false)
    const outside = at('.out')
    let elsewhere = true
    outside.addEventListener('keydown', (event) => (elsewhere = keyElsewhere(event, host)), {
      once: true,
    })
    struck(outside, ' ')
    expect(elsewhere).toBe(false)
  })
})

describe('a key pressed in a layer', () => {
  test('is the layer’s own, not the list’s it lies in or over', () => {
    const at = built(`
      <div class="list"><span class="row"></span>
        <div role="dialog"><button class="in"></button></div>
        <div role="menu"><span class="item"></span></div>
      </div>
      <div role="alertdialog"><button class="out"></button></div>`)
    const host = at('.list')
    const asked = (selector: string, over: Element | null = host) => {
      let held = false
      const node = at(selector)
      node.addEventListener('keydown', (event) => (held = keyElsewhere(event, over)), {
        once: true,
      })
      press(node, 'q')
      return held
    }
    expect(asked('.row')).toBe(false)
    expect(asked('.in')).toBe(true)
    expect(asked('.item')).toBe(true)
    expect(asked('.out')).toBe(true)
    expect(asked('.row', null)).toBe(false)
    expect(asked('.in', null)).toBe(true)
  })

  test('still drives a list that itself lies in a sheet', () => {
    const at = built(`
      <div role="dialog" aria-modal="true"><div class="list"><span class="row"></span>
        <div role="dialog"><button class="in"></button></div></div></div>`)
    const host = at('.list')
    const held: boolean[] = []
    host.addEventListener('keydown', (event) => held.push(keyElsewhere(event, host)))
    press(at('.row'), 'q')
    press(at('.in'), 'q')
    expect(held).toEqual([false, true])
  })
})
