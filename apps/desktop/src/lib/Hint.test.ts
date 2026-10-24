import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import Hint from './Hint.svelte'

/** The `?` after a label, and the sentence behind it (#768).
 *
 *  Rendered rather than described: the glyph has to be there, the sentence has to
 *  be the glyph's own name so a screen reader reads it, and neither may be a
 *  `title` - the browser's tooltip arrives late, in the system's font, and never
 *  at all under a finger. */

const SENTENCE = 'Only the standard markdown rules, no tables.'
const body = render(Hint, { props: { text: SENTENCE } }).body

describe('a hint', () => {
  test('draws the glyph', () => {
    expect(body).toContain('<svg')
    // Lucide's `circle-question-mark`: a circle, the hook of the mark, and its dot.
    // A question is what the reader has, so the mark is one (#768).
    expect(body).toContain('<circle')
    expect(body).toContain('d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"')
  })

  test('carries its sentence, as the name of the thing that shows it', () => {
    expect(body).toContain(`aria-label="${SENTENCE}"`)
  })

  test('is a control the keyboard reaches, not a decoration', () => {
    expect(body).toContain('<button')
    expect(body).not.toContain('tabindex="-1"')
  })

  test('is never the browser tooltip, which arrives late and never under a finger', () => {
    expect(body).not.toMatch(/\btitle=/)
  })
})

/** The settings panel draws the glyph after every declared row's name, in one slot, and
 *  after each row it writes out itself, each with a sentence of its own (#768). */
describe('where the panel draws it', () => {
  const panel = readFileSync(fileURLToPath(new URL('./SettingsPanel.svelte', import.meta.url)), {
    encoding: 'utf8',
  })

  test('in the one slot every declared row shares, and with a sentence on every other', () => {
    const drawn = [...panel.matchAll(/<Hint\b[^>]*\/>/g)].map((one) => one[0].replace(/\s+/g, ' '))
    expect(drawn.filter((one) => one === '<Hint text={field.hint} />')).toHaveLength(1)
    expect(panel).toContain('{#if field.hint}<Hint text={field.hint} />{/if}')

    const written = drawn.filter((one) => one !== '<Hint text={field.hint} />')
    expect(written.length).toBeGreaterThan(5)
    for (const one of written) expect(one).toMatch(/^<Hint text=\{t\('[^']+\.'\)\} \/>$/)
  })

  test('through the snippet every kind of row renders its name with', () => {
    // Eight kinds of row, one name between them: a glyph that landed in seven of
    // them and not the eighth is how one slot becomes two.
    const kinds = [...panel.matchAll(/field\.kind === '(\w+)'/g)].map((one) => one[1])
    expect(new Set(kinds)).toEqual(
      new Set(['switch', 'slider', 'segmented', 'swatches', 'picture', 'value', 'text', 'select']),
    )
    expect([...panel.matchAll(/\{@render named\(field, where\)\}/g)]).toHaveLength(8)
    expect(panel).toContain('{#snippet named(field: Field, where?: string)}')
  })
})
