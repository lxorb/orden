import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function source(path: string): string {
  return readFileSync(`${ROOT}${path}`, 'utf8')
}

const DOCUMENT_CSS = source('packages/themes/src/document.css')
const CANVAS_NODE = source('apps/desktop/src/lib/CanvasNode.svelte')
const READING = source('apps/desktop/src/lib/Reading.svelte')
const WEB_WIDGET = source('packages/editor/src/live-preview/web.ts')

function cardSelectors(): string[] {
  return [...DOCUMENT_CSS.matchAll(/^([^{}\n][^{}]*)\{/gm)]
    .map((one) => (one[1] ?? '').trim())
    .filter((one) => /\.embed-(web|wide|play|frame)\b/.test(one))
}

describe('the rules a web card is drawn with', () => {
  test('are found by the scan', () => {
    expect(cardSelectors().length).toBeGreaterThanOrEqual(5)
  })

  test('reach a canvas card as well as a document', () => {
    for (const selector of cardSelectors()) {
      expect(selector, selector).toContain(':is(#write, .orden-rendered)')
      expect(selector, selector).not.toMatch(/(^|[^,(])\s*#write\s+\./)
    }
  })

  test('and the canvas card says so on every rendered card it draws', () => {
    const rendered = [...CANVAS_NODE.matchAll(/<div class="card page[^"]*"/g)].map((one) => one[0])

    expect(rendered.length).toBeGreaterThanOrEqual(3)
    for (const one of rendered) expect(one, one).toContain('orden-rendered')
  })
})

describe('the press that loads the frame', () => {
  test('is the one loader in @orden/editor, on all three surfaces', () => {
    expect(WEB_WIDGET).toContain('embedClicks')
    expect(CANVAS_NODE).toContain('embedClicks')
    expect(CANVAS_NODE).toContain('use:embeds')
    expect(READING).toContain('loadEmbed')
  })
})
