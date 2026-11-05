import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

/** An answer already in the panel when the formula engine lands is drawn again then,
 *  and until then shows no TeX: its formulas keep their place unseen (#1122). The
 *  engine is fetched as the panel's answers are, so the first look is before it lands.
 *
 *  In the jsdom project because the answer is drawn and drawn again. */

/** The engine, held back until the test lets it land: an engine that arrives late. */
let land: () => void = () => undefined
const landed = new Promise<void>((resolve) => (land = resolve))
vi.mock('../../../../../../packages/markdown/src/maths.ts', async (actual) => {
  await landed
  return actual()
})

vi.mock('./chat.svelte', () => ({
  chat: { unfolded: false, root: '/n/Work', head: null, provider: null, models: {}, resets: {} },
}))

const engines = await import('@orden/markdown/engines')
const Reply = (await import('./Reply.svelte')).default

test('a formula already drawn is drawn again once its engine lands, and never as TeX', async () => {
  expect(engines.mathsEngine()).toBeNull()
  const turn = {
    id: 't1',
    role: 'assistant',
    parts: [{ kind: 'text', text: 'So \\(x^2\\) and\n\n\\[\n\\frac{1}{2}\n\\]\n\nand **bold**.' }],
  }
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Reply, {
    target,
    props: { turn: turn as never, sources: [], last: true, live: false },
  })
  flushSync()

  const words = () => target.querySelector('.words')
  // The first frame: the words drawn, the formulas held out of sight rather than TeX.
  expect(words()?.querySelector('strong')?.textContent).toBe('bold')
  expect(words()?.textContent).not.toContain('\\(')
  expect(words()?.textContent).not.toContain('\\[')
  expect(words()?.classList.contains('waiting')).toBe(true)
  expect(words()?.querySelectorAll('.math-inline, .math-block')).toHaveLength(2)

  // However long it takes, the formulas stay held rather than show their TeX.
  await new Promise((resolve) => setTimeout(resolve, 300))
  flushSync()
  expect(engines.mathsEngine()).toBeNull()
  expect(words()?.classList.contains('waiting')).toBe(true)

  land()
  await vi.waitFor(
    () => {
      flushSync()
      expect(words()?.querySelector('.math-inline .katex')).not.toBeNull()
    },
    { timeout: 20000 },
  )
  expect(words()?.querySelector('.math-block .katex-display')).not.toBeNull()
  expect(words()?.classList.contains('waiting')).toBe(false)

  void unmount(shown)
  target.remove()
})
