import { compile } from 'svelte/compiler'
import { describe, expect, test } from 'vitest'
import { DIR_AUTO, dirOnlyWhenTextChanged, reassignsDir } from '../svelte-dir'

const AUTO = `<script>let { text, lit = false } = $props()</script>
<p dir="auto" class:lit>{text}</p>
<span dir="auto">{text} and more</span>`
const compiled = (source: string, dev = false) =>
  compile(source, { generate: 'client', dev, filename: 'Probe.svelte' }).js.code
describe('a dir="auto" element in the compiled app (#2290)', () => {
  test('the installed Svelte still tells it its direction on every update, as the build expects', () => {
    for (const dev of [false, true]) {
      const code = compiled(AUTO, dev)
      expect(code).toMatch(/^\s*p\.dir = p\.dir;$/m)
      expect(code).toMatch(/^\s*span\.dir = span\.dir;$/m)
      expect(reassignsDir(code)).toBe(true)
    }
  })
  test('the build tells it only through the helper, which looks at its words first', () => {
    const code = compiled(AUTO)
    const kept = dirOnlyWhenTextChanged(code) ?? ''
    expect(reassignsDir(kept)).toBe(false)
    expect(kept).not.toMatch(/\.dir = \w+\.dir/)
    expect(kept).toMatch(/^\s*\$\$orden_dir_auto\(p\);$/m)
    expect(kept).toMatch(/^\s*\$\$orden_dir_auto\(span\);$/m)
    expect(kept).toContain(`import { dirAuto as $$orden_dir_auto } from ${JSON.stringify(DIR_AUTO)};`)
    expect(kept.slice(0, kept.indexOf('\nimport { dirAuto')).split('\n')).toHaveLength(code.split('\n').length)
  })
  test('whatever shape the update takes, and nothing that only looks like it', () => {
    expect(dirOnlyWhenTextChanged('$.template_effect(() => p_1.dir = p_1.dir);', '/h.ts')).toBe(
      '$.template_effect(() => $$orden_dir_auto(p_1));\nimport { dirAuto as $$orden_dir_auto } from "/h.ts";\n',
    )
    for (const code of ['a.dir = b.dir;', 'x.a.dir = a.dir;', 'p.dir = p.dir + 1;', 'p.dir = "auto";']) {
      expect(dirOnlyWhenTextChanged(code, '/h.ts')).toBeNull()
    }
  })
  test('and leaves alone a component with no dir="auto"', () => {
    expect(dirOnlyWhenTextChanged(compiled('<p class="x">{1}</p>'))).toBeNull()
  })
})
