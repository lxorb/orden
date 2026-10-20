// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { guarded, guardedBlock, LOOP_LIMIT } from './loop-guard'

/** Code compiled as a function of the names given. */
function compiled(...parts: string[]): (...args: unknown[]) => unknown {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the guarded code is what is under test
  return new Function(...parts) as (...args: unknown[]) => unknown
}

/** Every loop in a block's scripts made to give up (#525): in WebKit the block's frame
 *  shares the app's thread, and a loop that never ends froze the whole app. */

/** Runs guarded code with a check that says leave after `rounds` of asking. */
function runs(code: string, rounds = 5): number {
  let asked = 0
  const spin = () => ++asked > rounds
  compiled('__nibSpin', guarded(code))(spin)
  return asked
}

describe('a loop in a block', () => {
  test('of every kind leaves when it is told to', () => {
    expect(runs('while (true) {}')).toBe(6)
    expect(runs('for (;;) {}')).toBe(6)
    expect(runs('do {} while (true)')).toBe(6)
    expect(runs('const o = { a: 1 }\nfor (;;) for (const k in o) {}')).toBeGreaterThan(5)
    expect(runs('outer: while (true) while (true) continue outer')).toBeGreaterThan(5)
  })

  test('without braces, as one statement', () => {
    expect(runs('let i = 0\nwhile (true) i++')).toBe(6)
    expect(runs('let i = 0\nif (true) while (true) i++\nelse i--')).toBe(6)
  })

  test('that ends by itself does what it did', () => {
    let total = 0
    const add = (n: number) => (total += n)
    compiled('__nibSpin', 'add', guarded('for (let i = 1; i <= 4; i++) add(i)'))(() => false, add)
    expect(total).toBe(10)
  })

  test('is left as written where the code does not parse, or holds none', () => {
    expect(guarded('while (')).toBe('while (')
    expect(guarded('const a = 1')).toBe('const a = 1')
  })

  test('in a string or a comment is not a loop', () => {
    const code = "const s = 'while (true) {}' // for (;;) {}"
    expect(guarded(code)).toBe(code)
  })
})

describe('a block of a note’s own HTML', () => {
  test('gets the check ahead of its scripts, and guarded scripts', () => {
    const html = '<div id="dial">x</div>\n<script>while (true) {}</script>'
    const out = guardedBlock(html)
    const holder = document.createElement('template')
    holder.innerHTML = out
    const scripts = [...holder.content.querySelectorAll('script')].map((one) => one.textContent)

    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toContain("defineProperty(globalThis, '__nibSpin'")
    expect(scripts[1]).toBe('while (true) {if(__nibSpin())break;}')
    expect(holder.content.querySelector('#dial')?.textContent).toBe('x')
  })

  test('with no script in it is left exactly as written', () => {
    const html = '<b>bold</b> <script type="text/template">while (true) {}</script>'
    expect(guardedBlock(html)).toBe(html)
  })

  test('guards a module the same way, and leaves a data block alone', () => {
    const out = guardedBlock(
      '<script type="module">for (;;) {}</script><script type="text/template">for (;;) {}</script>',
    )
    expect(out).toContain('<script type="module">for (;;) {if(__nibSpin())break;}</script>')
    expect(out).toContain('<script type="text/template">for (;;) {}</script>')
  })
})

describe('the check the frame runs first', () => {
  test('lets a loop go on until its task has run past the limit, and cannot be replaced', () => {
    const holder = document.createElement('template')
    holder.innerHTML = guardedBlock('<script>for (;;) {}</script>')
    const [check, script] = [...holder.content.querySelectorAll('script')].map(
      (one) => one.textContent,
    )
    compiled(check ?? '')()

    let now = 0
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (now += 1))
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      compiled(script ?? '')()
      expect(now).toBeGreaterThanOrEqual(LOOP_LIMIT)
      expect(said).toHaveBeenCalledOnce()
    } finally {
      clock.mockRestore()
      said.mockRestore()
    }

    const global = globalThis as Record<string, unknown>
    expect(() => {
      global.__nibSpin = () => false
    }).toThrow()
  })
})
