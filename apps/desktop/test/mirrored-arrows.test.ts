import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function componentFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...componentFiles(path))
    else if (name.endsWith('.svelte')) out.push(path)
  }

  return out
}

const ARROW =
  /(?:icon|fallback)=\{(?:Arrow|Chevron)(?:Left|Right)\}|#each (?:Arrow|Chevron)(?:Left|Right) as|<Glyph name="(?:left|right)"/

const PLACED = new Set(['lib/chats/view/Lightbox.svelte', 'lib/back-swipe/SwipeArrow.svelte'])

test('an arrow that points along the line turns round in a right-to-left language', () => {
  const unturned = componentFiles(SOURCE).flatMap((path) => {
    const name = path.slice(SOURCE.length).replace(/\\/g, '/')
    if (PLACED.has(name)) return []
    const lines = readFileSync(path, 'utf8').split('\n')
    return lines.flatMap((line, at) => {
      if (!ARROW.test(line)) return []
      const tag = lines.slice(Math.max(0, at - 6), at + 1).join('\n')
      return tag.includes('orden-mirror') ? [] : [`${name}:${String(at + 1)}`]
    })
  })

  expect(unturned).toEqual([])
})

test('the ones that stay put point at the side they sit on', () => {
  const lightbox = readFileSync(join(SOURCE, 'lib/chats/view/Lightbox.svelte'), 'utf8')
  expect(lightbox).toMatch(/class="orden-glyph side left"[\s\S]*?<Glyph name="left" \/>/)
  expect(lightbox).toMatch(/class="orden-glyph side right"[\s\S]*?<Glyph name="right" \/>/)
  const swipe = readFileSync(join(SOURCE, 'lib/back-swipe/SwipeArrow.svelte'), 'utf8')
  expect(swipe).toMatch(/\.orden-swipe\.right \.arrow \{\s*transform: scaleX\(-1\);/)
})
