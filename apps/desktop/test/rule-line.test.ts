import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/** A rule is a line, and nothing hangs off the end of it.
 *
 *  A note whose rules break it into slides says so by drawing those rules in the
 *  accent rather than in the line colour - the mark is the shape of the rule, in
 *  a different colour, and that is the whole of it. There used to be a dot in the
 *  margin as well, four pixels of accent hanging off the left end, and it read as
 *  a list bullet, or as the block grip, or as something gone wrong.
 *
 *  It was also far wider than its name: two paragraphs with a rule between them
 *  is a deck as far as `isDeck` is concerned, so an ordinary note that used a
 *  rule as a divider grew the dot too. That is what Emil saw.
 *
 *  So this refuses anything drawn in front of a rule line. A pseudo-element on a
 *  `.cm-line` is not a small thing: the line is a row of text the editor owns,
 *  and whatever is put beside it is out in the margin the block grip and the fold
 *  marker already live in. See the shots the rules drive writes. */

const EDITOR = fileURLToPath(new URL('../../../packages/themes/src/editor.css', import.meta.url))

/** Every selector in the sheet, paired with the declarations under it. Comments
 *  first, because a note about a dot is not a dot. */
function rules(css: string): { selector: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { selector: string; body: string }[] = []

  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: (match[1] ?? '').trim(), body: (match[2] ?? '').trim() })
  }

  return out
}

const SHEET = rules(readFileSync(EDITOR, 'utf8'))

describe('the rule that breaks a slide', () => {
  test('is styled at all, so the deck still says where it breaks', () => {
    const found = SHEET.filter((one) => one.selector.includes('nib-slide-break'))
    expect(found.length).toBeGreaterThan(0)
  })

  test('changes the colour of the hairline and nothing else', () => {
    for (const one of SHEET) {
      if (!one.selector.includes('nib-slide-break')) continue

      // Nothing drawn beside the line: a pseudo-element here lands in the margin
      // the block grip and the fold marker already use.
      expect(one.selector, one.selector).not.toMatch(/::?(before|after)\b/)
      expect(one.body, one.selector).not.toMatch(/\bcontent\s*:/)
    }
  })

  test('and no line in the editor draws a bead in its margin', () => {
    // A round, filled, few-pixels-wide pseudo-element on a line is the shape the
    // dot had. The list bullet is a widget of its own and is not a `.cm-line`.
    for (const one of SHEET) {
      if (!/\.cm-line[^,{]*::?(before|after)\b/.test(one.selector)) continue

      const round = /border-radius\s*:\s*(50%|999)/.test(one.body)
      const filled = /background\s*:\s*var\(--accent/.test(one.body)
      expect(round && filled, `${one.selector} draws a dot: ${one.body}`).toBe(false)
    }
  })
})
