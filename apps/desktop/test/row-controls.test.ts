import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'

/** What may stand at the end of a row of settings.
 *
 *  `.nib-setting` is a name on the left and a control on the right, and the name is
 *  what gives way. `.nib-action` is the other kind of action: a line of words across a
 *  card, as wide as the card. Put one at the end of a row and it takes the whole row,
 *  the name is left no width at all, and its words are drawn a letter to a line down
 *  the window - which is what Settings > Online terminal did with Restart (issue 245).
 *  The action at the end of a row is `.nib-chip`; see base.css. */

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

interface Node {
  type: string
  name?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  [key: string]: unknown
}

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return components(path)
    return one.name.endsWith('.svelte') ? [path] : []
  })
}

/** The static half of an element's `class`, plus every `class:name` it may wear. */
function classesOf(node: Node): string[] {
  const words: string[] = []
  for (const one of node.attributes ?? []) {
    if (one.type === 'ClassDirective' && one.name) words.push(one.name)
    if (one.type !== 'Attribute' || one.name !== 'class' || !Array.isArray(one.value)) continue
    for (const part of one.value as { type: string; data?: string }[])
      if (part.type === 'Text') words.push(...(part.data ?? '').split(/\s+/))
  }
  return words.filter(Boolean)
}

/** Every element under a node, through blocks as well as elements, each with whether a
 *  row of settings holds it. */
function* elements(node: unknown, inRow = false): Generator<{ node: Node; inRow: boolean }> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* elements(one, inRow)
    return
  }

  const one = node as Node
  let under = inRow
  if (one.type === 'RegularElement') {
    yield { node: one, inRow }
    under = inRow || classesOf(one).includes('nib-setting')
  }
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* elements(value, under)
  }
}

test('no row of settings ends in an action that is as wide as a card', () => {
  const files = components(SRC)
  expect(files.length).toBeGreaterThan(100)

  const wide = files.flatMap((file) => {
    const tree = parse(readFileSync(file, 'utf8'), { modern: true })
    return [...elements(tree.fragment)]
      .filter((one) => one.inRow && classesOf(one.node).includes('nib-action'))
      .map(() => file.slice(SRC.length).replaceAll('\\', '/'))
  })

  expect(wide).toEqual([])
})
