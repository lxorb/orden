import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'

const PASS = fileURLToPath(new URL('../src/lib/pass-ui/src/', import.meta.url))

interface Node {
  type: string
  name?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  [key: string]: unknown
}

function textOf(node: Node, name: string): string | null {
  const found = node.attributes?.find((one) => one.type === 'Attribute' && one.name === name)
  if (!found || !Array.isArray(found.value)) return null
  return (found.value as { type: string; data?: string }[])
    .map((one) => (one.type === 'Text' ? (one.data ?? '') : ''))
    .join('')
}

function framed(node: Node): boolean {
  return (textOf(node, 'class') ?? '').split(/\s+/).includes('orden-edit-row')
}

function* bare(node: unknown, inRow: boolean): Generator<string> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* bare(one, inRow)
    return
  }
  const one = node as Node
  const row = inRow || (one.type === 'RegularElement' && framed(one))
  if (
    one.type === 'RegularElement' &&
    (one.name === 'input' || one.name === 'textarea') &&
    textOf(one, 'type') !== 'file' &&
    !row
  ) {
    yield `${one.name}.${textOf(one, 'class') ?? ''}`
  }
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* bare(value, row)
  }
}

test('every field typed into a Pass item editor sits in a row that frames it on focus', () => {
  const editors = readdirSync(PASS).filter(
    (name) =>
      name.endsWith('Edit.svelte') ||
      name === 'EditField.svelte' ||
      name === 'PasswordField.svelte',
  )
  expect(editors.length).toBeGreaterThan(8)
  const found = editors.flatMap((name) => {
    const ast = parse(readFileSync(join(PASS, name), 'utf8'), { modern: true })
    return [...bare(ast.fragment, false)].map((one) => `${name}: ${one}`)
  })
  expect(found).toEqual([])
})
