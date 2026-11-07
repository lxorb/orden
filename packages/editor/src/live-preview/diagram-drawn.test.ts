// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'
import { DiagramWidget } from './render'

const drawn = vi.hoisted(() => ({ times: 0, failing: 0 }))

vi.mock('mermaid', () => ({
  default: {
    initialize: () => undefined,
    render: (id: string, code: string) => {
      drawn.times++
      if (drawn.failing > 0) {
        drawn.failing--
        return Promise.reject(new Error('Parse error'))
      }
      const style = `#${id}{fill:red;}#${id} .node{stroke:blue;}`
      return Promise.resolve({
        svg: `<svg id="${id}"><style>${style}</style><text>${code}</text></svg>`,
      })
    },
  },
}))

async function settled(host: HTMLElement) {
  await vi.waitFor(() => expect(host.querySelector('svg')).not.toBeNull(), { interval: 1 })
}

describe('a diagram drawn again', () => {
  test('scrolled back into view is shown at once, not drawn a second time', async () => {
    const first = new DiagramWidget('graph TD\nA-->B', 'mermaid').toDOM()
    await settled(first)
    expect(drawn.times).toBe(1)

    const again = new DiagramWidget('graph TD\nA-->B', 'mermaid').toDOM()
    expect(again.querySelector('svg')).not.toBeNull()
    expect(again.innerHTML).toBe(first.innerHTML)
    expect(drawn.times).toBe(1)
  })

  test('with other code, or in the other theme, is drawn for itself', async () => {
    const before = drawn.times
    await settled(new DiagramWidget('graph TD\nA-->C', 'mermaid').toDOM())
    expect(drawn.times).toBe(before + 1)

    document.documentElement.dataset.theme = 'light'
    await settled(new DiagramWidget('graph TD\nA-->C', 'mermaid').toDOM())
    expect(drawn.times).toBe(before + 2)
    delete document.documentElement.dataset.theme
  })

  test('only the most recent are kept', async () => {
    const before = drawn.times
    for (let one = 0; one < 150; one++) {
      await settled(new DiagramWidget(`graph TD\nN${one}`, 'mermaid').toDOM())
    }
    expect(drawn.times).toBe(before + 150)

    new DiagramWidget('graph TD\nN149', 'mermaid').toDOM()
    expect(drawn.times).toBe(before + 150)
    await settled(new DiagramWidget('graph TD\nN0', 'mermaid').toDOM())
    expect(drawn.times).toBe(before + 151)
  })

  test('shares one style sheet, not a style of its own that restyles the whole page', async () => {
    const one = new DiagramWidget('graph TD\nS-->T', 'mermaid').toDOM()
    await settled(one)
    const other = new DiagramWidget('graph LR\nS-->T', 'mermaid').toDOM()
    await settled(other)

    expect(one.querySelector('style')).toBeNull()
    expect(other.querySelector('style')).toBeNull()
    const shared = [...document.head.querySelectorAll('style')]
    expect(shared).toHaveLength(1)
    const name = 'orden-diagram-style-0'
    expect(one.querySelector('svg')?.classList.contains(name)).toBe(true)
    expect(other.querySelector('svg')?.classList.contains(name)).toBe(true)
    const said = shared[0]?.textContent ?? ''
    expect(said).toContain(`:is(.${name}, #${name}){fill:red;}`)
    expect(said).toContain(`:is(.${name}, #${name}) .node{stroke:blue;}`)
  })

  test('a diagram that failed is tried again the next time', async () => {
    const before = drawn.times
    drawn.failing = 1
    const failed = new DiagramWidget('graph TD\nX-->Y', 'mermaid').toDOM()
    await vi.waitFor(() => expect(failed.className).toContain('orden-diagram-error'), {
      interval: 1,
    })

    await settled(new DiagramWidget('graph TD\nX-->Y', 'mermaid').toDOM())
    expect(drawn.times).toBe(before + 2)
  })
})
