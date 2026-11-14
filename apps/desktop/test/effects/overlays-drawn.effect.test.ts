import { beforeEach, describe, expect, test, vi } from 'vitest'
import { overlays } from '../../src/lib/ui-kit/src/overlays'

let strip: HTMLDivElement
let panel: HTMLDivElement
let button: HTMLButtonElement

beforeEach(() => {
  document.body.innerHTML = `
    <div id="strip"><div id="panel" style="background: #fff; padding: 8px"><span id="words">Pen</span></div>
      <button id="button" style="border: 1px solid">Pen</button></div>`
  strip = document.getElementById('strip') as HTMLDivElement
  panel = document.getElementById('panel') as HTMLDivElement
  button = document.getElementById('button') as HTMLButtonElement
})

function opened() {
  const close = vi.fn()
  const off = overlays.show(close, () => [strip])
  return { close, off }
}

describe('a popup held by a box wider than it draws', () => {
  test('closes on a press in the bare box beside what it draws', () => {
    const { close, off } = opened()
    overlays.pressed({ target: strip })
    expect(close).toHaveBeenCalled()
    off()
  })

  test('stays on a press on its panel, its padding, or its button', () => {
    for (const target of [panel, document.getElementById('words'), button]) {
      const { close, off } = opened()
      overlays.pressed({ target })
      expect(close, (target as Element).id).not.toHaveBeenCalled()
      off()
    }
  })

  test('stays on a press on a held element that draws itself', () => {
    const close = vi.fn()
    const off = overlays.show(close, () => [panel])
    overlays.pressed({ target: panel })
    expect(close).not.toHaveBeenCalled()
    off()
  })
})
