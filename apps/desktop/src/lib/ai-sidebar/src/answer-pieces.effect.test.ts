import { expect, test } from 'vitest'
import { drawInPieces } from './answer-pieces'

function steps() {
  const waiting: (() => void)[] = []
  return {
    later: (run: () => void) => {
      waiting.push(run)
      return () => void waiting.splice(waiting.indexOf(run), 1)
    },
    run: () => {
      let ran = 0
      while (waiting.length) {
        waiting.shift()?.()
        ran++
      }
      return ran
    },
    left: () => waiting.length,
  }
}

const long = Array.from(
  { length: 400 },
  (_, at) => `<h2>Part ${String(at)}</h2><p>${'Herons stand still. '.repeat(10)}${String(at)}</p>`,
).join('')

test('a short answer is drawn at once', () => {
  const node = document.createElement('div')
  const html = '<p>Herons stand still.</p>'
  const { later, left } = steps()
  drawInPieces(node, html, later)
  expect(node.innerHTML).toBe(html)
  expect(left()).toBe(0)
})

test('a long answer shows its end first, then the rest above it, piece by piece, as it was', () => {
  expect(long.length).toBeGreaterThan(50_000)
  const node = document.createElement('div')
  const { later, run } = steps()
  drawInPieces(node, long, later)
  expect(node.textContent).toContain('Part 399')
  expect(node.textContent).not.toContain('Part 0 ')
  expect(node.textContent.length).toBeLessThan(12_000)
  expect(run()).toBeGreaterThan(3)
  expect(node.innerHTML).toBe(long)
})

test('a long answer let go, or drawn again, draws no more of the old one', () => {
  const node = document.createElement('div')
  const { later, run } = steps()
  const stop = drawInPieces(node, long, later)
  stop()
  expect(run()).toBe(0)
  drawInPieces(node, '<p>Egrets.</p>', later)
  expect(node.innerHTML).toBe('<p>Egrets.</p>')
})

test('what is drawn above the screen keeps the reader where they were', () => {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  const node = document.createElement('div')
  box.append(node)
  document.body.append(box)
  let height = 1_000
  let top = 400
  Object.defineProperty(box, 'scrollHeight', { get: () => height })
  Object.defineProperty(box, 'scrollTop', { get: () => top, set: (to: number) => (top = to) })
  const prepend = node.prepend.bind(node)
  node.prepend = (...nodes) => {
    prepend(...nodes)
    height += 300
  }
  let seen = -500
  node.getBoundingClientRect = () => ({ top: seen }) as DOMRect
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  const { later, run } = steps()
  drawInPieces(node, long, later)
  run()
  expect(top).toBeGreaterThan(400)
  expect(height - top).toBe(600)

  top = 0
  seen = 100
  height = 1_000
  drawInPieces(node, long, later)
  run()
  expect(top).toBe(0)
  box.remove()
})

test('long answers drawn at once in one list measure it once a step, not once an answer', () => {
  const box = document.createElement('div')
  box.style.overflowY = 'auto'
  const first = document.createElement('div')
  const second = document.createElement('div')
  box.append(first, second)
  document.body.append(box)
  let height = 1_000
  let top = 400
  let reads = 0
  Object.defineProperty(box, 'scrollHeight', {
    get: () => {
      reads++
      return height
    },
  })
  Object.defineProperty(box, 'scrollTop', { get: () => top, set: (to: number) => (top = to) })
  for (const node of [first, second]) {
    const prepend = node.prepend.bind(node)
    node.prepend = (...nodes) => {
      prepend(...nodes)
      height += 300
    }
    node.getBoundingClientRect = () => ({ top: -500, height: 0 }) as DOMRect
  }
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect

  const alone = steps()
  drawInPieces(document.createElement('div'), long, alone.later)
  const stepsOfOne = alone.run()

  const { later, run } = steps()
  drawInPieces(first, long, later)
  drawInPieces(second, long, later)
  const ran = run()

  expect(ran).toBe(stepsOfOne)
  expect(reads).toBe(2 * ran)
  expect(first.innerHTML).toBe(long)
  expect(second.innerHTML).toBe(long)
  expect(height - top).toBe(600)
  box.remove()
})
