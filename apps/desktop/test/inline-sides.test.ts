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

const PHYSICAL: Record<string, string> = {
  'lib/Titlebar.svelte': 'the traffic lights sit on the left of a Mac window in every language',
  'lib/CanvasBar.svelte': 'the bar is placed where it was dropped, at a point on the screen',
  'lib/ai-sidebar/src/Conversation.svelte': 'half its own width back, to centre it on 50%',
}

test('a margin or padding beside the words follows the reading direction', () => {
  const physical = componentFiles(SOURCE).flatMap((path) => {
    const name = path.slice(SOURCE.length).replace(/\\/g, '/')
    if (name in PHYSICAL) return []
    const style = [...readFileSync(path, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((one) => one[1] ?? '')
      .join('\n')
    return [...style.matchAll(/\b(?:margin|padding)-(?:left|right)\s*:/g)].map(
      (one) => `${name}: ${one[0]}`,
    )
  })

  expect(physical).toEqual([])
})
