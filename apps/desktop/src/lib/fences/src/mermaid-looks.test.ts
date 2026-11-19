import { expect, test, vi } from 'vitest'

const { default: mermaid } = await import('mermaid')
const { drawDiagram } = await import('./diagrams')
test('two diagrams drawn at once are each drawn in their own looks', async () => {
  let looks: { theme?: string } = {}
  vi.spyOn(mermaid, 'initialize').mockImplementation((next) => {
    looks = next
  })
  vi.spyOn(mermaid, 'render').mockImplementation(async (_id, code) => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return { svg: `${code} in ${looks.theme ?? 'nothing'}`, diagramType: 'flowchart' }
  })
  const drawn = await Promise.all([
    drawDiagram('graph TD; A-->B', 'mermaid', 'light'),
    drawDiagram('graph TD; C-->D', 'mermaid', 'dark'),
  ])
  expect(drawn).toEqual(['graph TD; A-->B in default', 'graph TD; C-->D in dark'])
})
