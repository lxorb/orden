import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { render } from 'svelte/server'
import Hint from './Hint.svelte'

const SENTENCE = 'Only the standard markdown rules, no tables.'
const body = render(Hint, { props: { text: SENTENCE } }).body

describe('a hint', () => {
  test('draws the glyph', () => {
    expect(body).toContain('<svg')
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

  test('is glued to the last word of its label, so a line never breaks before it (#1052)', () => {
    expect(body).toContain('\u2060<button')
  })
})

describe('the labels it follows', () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), { encoding: 'utf8' })
  const rule = (css: string, selector: string) => {
    const at = css.lastIndexOf(`${selector} {`)
    expect(at).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf('}', at))
  }

  test('are a run of text, not a flex row', () => {
    const panel = read('./SettingsPanel.svelte')
    const base = read('../../../../packages/themes/src/base.css')
    for (const one of [
      rule(panel, '.setting .name .what'),
      rule(base, '.nib-setting .name .nib-named'),
    ]) {
      expect(one).toContain('display: block')
      expect(one).not.toMatch(/display: (inline-)?flex|align-items|gap:/)
    }
  })
})

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
    const kinds = [...panel.matchAll(/field\.kind === '(\w+)'/g)].map((one) => one[1])
    expect(new Set(kinds)).toEqual(
      new Set(['switch', 'slider', 'segmented', 'swatches', 'picture', 'value', 'text', 'select']),
    )
    expect([...panel.matchAll(/\{@render named\(field, where\)\}/g)]).toHaveLength(9)
    expect(panel).toContain('{#snippet named(field: Field, where?: string)}')
  })
})
