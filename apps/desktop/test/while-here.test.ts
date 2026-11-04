import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

/** The strip and the pane fetch what they rarely need when it is first asked for, and
 *  every such fetch goes through `here` (src/lib/while-here.ts), so what lands after the
 *  strip or the pane has gone does nothing. A bare `import()` in their scripts would be
 *  one that still acts on a component that is not there. */

const SOURCE = new URL('../src/lib/', import.meta.url)
const scriptOf = (name: string) => {
  const text = readFileSync(new URL(name, SOURCE), 'utf8')
  return text.slice(0, text.indexOf('</script>'))
}

test.each(['Tabs.svelte', 'Pane.svelte'])(
  '%s hears every part it fetches only while it is there',
  (name) => {
    const script = scriptOf(name)
    const bare = script
      .split('\n')
      .filter((line) => /(?<!typeof )\bimport\('/.test(line) && !line.includes("here(import('"))
    expect(bare, `${name} fetches without here(): ${bare.join(' | ')}`).toEqual([])
    expect(script).toContain('const here = whileHere()')
  },
)
