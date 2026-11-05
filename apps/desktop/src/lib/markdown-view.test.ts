import { expect, test, vi } from 'vitest'

/** The renderer's parts land after the first frame of an answer may be drawn: the
 *  formula engine, a fence's grammar. An answer drawn before then is drawn again when
 *  they do, and is never shown as its TeX in the meantime (#1122). Each test with the
 *  modules fresh, so the engine is not here yet. */

async function fresh() {
  vi.resetModules()
  const engines = await import('@orden/markdown/engines')
  const view = await import('./markdown-view.svelte')
  return { engines, view }
}

test('an answer drawn before the formula engine is drawn again once it lands', async () => {
  const { engines, view } = await fresh()
  expect(engines.mathsEngine()).toBeNull()

  const before = view.drawing.version
  const first = view.viewHtml('So \\(x^2\\) is.')
  // Not yet a formula, and held out of sight rather than shown as TeX.
  expect(first).not.toContain('class="katex"')
  expect(view.mathsWaiting(first)).toBe(true)

  // Asked for by the draw itself; what tells the surfaces is the version moving.
  await vi.waitFor(() => expect(view.drawing.version).toBeGreaterThan(before), { timeout: 20000 })
  const again = view.viewHtml('So \\(x^2\\) is.')
  expect(again).toContain('class="katex"')
  expect(view.mathsWaiting(again)).toBe(false)
})

test('a surface that opens fetches the formula engine before any answer asks', async () => {
  const { engines, view } = await fresh()
  view.warmRenderer()
  await vi.waitFor(() => expect(engines.mathsEngine()).not.toBeNull(), { timeout: 20000 })
  expect(view.viewHtml('$$\n\\frac{1}{2}\n$$')).toContain('katex-display')
})

test('an answer with no formula is never held', async () => {
  const { view } = await fresh()
  expect(view.mathsWaiting(view.viewHtml('Just **words**, costing $5.'))).toBe(false)
})
