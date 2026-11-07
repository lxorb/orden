import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { expect, test } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

interface Node {
  type: string
  name?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  [key: string]: unknown
}

const CONTROL_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary'])
const CONTROL_ROLES = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'slider',
  'switch',
  'tab',
])
const CONTROL_COMPONENTS = new Set(['Hint'])

function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return components(path)
    return one.name.endsWith('.svelte') ? [path] : []
  })
}

function roleOf(node: Node): string | null {
  const role = node.attributes?.find((one) => one.type === 'Attribute' && one.name === 'role')
  if (!role || !Array.isArray(role.value)) return null
  const [only] = role.value as { type: string; data?: string }[]
  return only?.type === 'Text' ? (only.data ?? null) : null
}

function isControl(node: Node): boolean {
  if (node.type === 'Component') return CONTROL_COMPONENTS.has(node.name ?? '')
  if (node.type !== 'RegularElement') return false
  const role = roleOf(node)
  if (role !== null) return CONTROL_ROLES.has(role)
  return CONTROL_TAGS.has(node.name ?? '')
}

function holds(node: Node): boolean {
  return node.type === 'RegularElement' && roleOf(node) !== 'option'
}

function* nested(node: unknown, within: Node | null): Generator<[Node, Node]> {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const one of node) yield* nested(one, within)
    return
  }

  const one = node as Node
  let holder = within
  if (isControl(one)) {
    if (within) yield [within, one]
    if (holds(one)) holder = one
  }
  for (const [key, value] of Object.entries(one)) {
    if (key !== 'attributes' && value && typeof value === 'object') yield* nested(value, holder)
  }
}

function named(node: Node): string {
  const role = node.type === 'RegularElement' ? roleOf(node) : null
  return role ? `${node.name}[role=${role}]` : (node.name ?? node.type)
}

test('no control holds another, which a screen reader cannot reach and a press reaches twice', () => {
  const files = components(SRC)
  expect(files.length).toBeGreaterThan(100)

  const found = files.flatMap((file) => {
    const tree = parse(readFileSync(file, 'utf8'), { modern: true })
    return [...nested(tree.fragment, null)].map(
      ([outer, inner]) =>
        `${file.slice(SRC.length).replaceAll('\\', '/')}: ${named(inner)} in ${named(outer)}`,
    )
  })

  expect(found).toEqual([])
})
