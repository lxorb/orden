import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

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
