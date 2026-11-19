import type { MermaidConfig } from 'mermaid'

let last: Promise<unknown> = Promise.resolve()
export function mermaidSvg(id: string, code: string, config: MermaidConfig): Promise<string> {
  const turn = last.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize(config)
    try {
      const { svg } = await mermaid.render(id, code)
      return svg
    } finally {
      if (typeof document !== 'undefined') document.getElementById(`d${id}`)?.remove()
    }
  })
  last = turn.catch(() => undefined)
  return turn
}
