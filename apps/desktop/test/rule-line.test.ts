import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const EDITOR = fileURLToPath(new URL('../../../packages/themes/src/editor.css', import.meta.url))

function rules(css: string): { selector: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { selector: string; body: string }[] = []

  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: (match[1] ?? '').trim(), body: (match[2] ?? '').trim() })
  }

  return out
}

const SHEET = rules(readFileSync(EDITOR, 'utf8'))

describe('the horizontal rule', () => {
  test('no line in the editor draws a bead in its margin', () => {
    for (const one of SHEET) {
      if (!/\.cm-line[^,{]*::?(before|after)\b/.test(one.selector)) continue

      const round = /border-radius\s*:\s*(50%|999)/.test(one.body)
      const filled = /background\s*:\s*var\(--accent/.test(one.body)
      expect(round && filled, `${one.selector} draws a dot: ${one.body}`).toBe(false)
    }
  })
})
