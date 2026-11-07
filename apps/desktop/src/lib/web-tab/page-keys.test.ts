import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, test } from 'vitest'

const source = readFileSync(new URL('../../../src-tauri/src/web_opens.rs', import.meta.url), 'utf8')
const script = /pub const SCRIPT: &str = r"([\s\S]*?)";/.exec(source)?.[1] ?? ''

type Listening = 'bare' | 'stops' | 'takes'

function page(listening: Listening) {
  const dom = new JSDOM('<input id="field">', { runScripts: 'outside-only' })
  const asked: string[] = []
  const inside = dom.window as unknown as Window & typeof globalThis
  inside.open = (_url?: string | URL, name?: string) => {
    asked.push(name ?? '')
    return null
  }
  inside.eval(script.replaceAll('!event.isTrusted', 'false'))

  const field = inside.document.getElementById('field') as HTMLInputElement
  for (const type of ['keydown', 'keyup']) {
    field.addEventListener(type, (event) => {
      if (listening !== 'bare') event.stopPropagation()
      if (listening === 'takes') event.preventDefault()
    })
  }

  const press = (type: 'keydown' | 'keyup', init: KeyboardEventInit & { keyCode?: number }) =>
    field.dispatchEvent(
      new inside.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }),
    )
  const settled = () => new Promise((done) => inside.setTimeout(done, 5))
  return { asked, press, settled }
}

async function pressedWithCtrl(listening: Listening, keyCode: number, shiftKey = false) {
  const { asked, press, settled } = page(listening)
  press('keydown', { key: 'x', keyCode, ctrlKey: true, shiftKey })
  await settled()
  return asked
}

async function shiftTwice(listening: Listening) {
  const { asked, press, settled } = page(listening)
  for (let tap = 0; tap < 2; tap++) {
    press('keydown', { key: 'Shift', shiftKey: true })
    press('keyup', { key: 'Shift' })
  }
  await settled()
  return asked
}

describe('Ctrl+Space in a page', () => {
  test('asks when nothing in the page heard it', async () => {
    expect(await pressedWithCtrl('bare', 32)).toEqual(['orden-ctrl-space'])
  })

  test('asks when a field keeps it from the page and leaves its default', async () => {
    expect(await pressedWithCtrl('stops', 32)).toEqual(['orden-ctrl-space'])
    expect(await pressedWithCtrl('stops', 32, true)).toEqual(['orden-ctrl-shift-space'])
  })

  test("is the page's when it takes it", async () => {
    expect(await pressedWithCtrl('takes', 32)).toEqual([])
  })
})

describe('Shift twice in a page', () => {
  test('asks once when nothing in the page heard it', async () => {
    expect(await shiftTwice('bare')).toEqual(['orden-twice-shift'])
  })

  test('asks once when a field keeps it from the page', async () => {
    expect(await shiftTwice('stops')).toEqual(['orden-twice-shift'])
  })

  test("is the page's when it takes it", async () => {
    expect(await shiftTwice('takes')).toEqual([])
  })
})

describe('the keys an engine or a page has its own use for', () => {
  test("Ctrl+F kept from the page is the engine's, whose own find opens", async () => {
    expect(await pressedWithCtrl('stops', 70)).toEqual([])
    expect(await pressedWithCtrl('bare', 70)).toEqual(['orden-find'])
  })

  test("Ctrl+0 kept from the page is the engine's", async () => {
    expect(await pressedWithCtrl('stops', 48)).toEqual([])
  })

  test("an Escape kept from the page closed something of the page's", async () => {
    const { asked, press, settled } = page('stops')
    press('keydown', { key: 'Escape', keyCode: 27 })
    await settled()
    expect(asked).toEqual([])
  })
})

describe('the same keys on the engine with no answer of its own', () => {
  const onChromium = /const STOPPED_ENGINE_KEYS: &str = "(.*?)";/.exec(source)?.[1] ?? ''

  test.each([
    [70, 'orden-find'],
    [71, 'orden-find-next'],
    [48, 'orden-actual-size'],
  ])('key %i kept from the page asks %s', async (code, name) => {
    expect(onChromium).not.toBe('')
    const dom = new JSDOM('<input id="field">', { runScripts: 'outside-only' })
    const asked: string[] = []
    const inside = dom.window as unknown as Window & typeof globalThis
    inside.open = (_url?: string | URL, called?: string) => {
      asked.push(called ?? '')
      return null
    }
    inside.eval(script.replaceAll('!event.isTrusted', 'false').replace(onChromium, '/^$/'))
    const field = inside.document.getElementById('field') as HTMLInputElement
    field.addEventListener('keydown', (event) => event.stopPropagation())
    const init: KeyboardEventInit & { keyCode: number } = {
      bubbles: true,
      cancelable: true,
      key: 'x',
      keyCode: code,
      ctrlKey: true,
    }
    field.dispatchEvent(new inside.KeyboardEvent('keydown', init))
    await new Promise((done) => inside.setTimeout(done, 5))
    expect(asked).toEqual([name])
  })
})

describe('the other chords, which only a preventDefault keeps', () => {
  test.each([
    [68, false, 'orden-ctrl-d'],
    [68, true, 'orden-ctrl-shift-d'],
    [72, false, 'orden-ctrl-h'],
    [76, false, 'orden-address'],
  ])('key %i with Shift %s asks %s', async (code, shift, name) => {
    expect(await pressedWithCtrl('stops', code, shift)).toEqual([name])
    expect(await pressedWithCtrl('takes', code, shift)).toEqual([])
  })
})
