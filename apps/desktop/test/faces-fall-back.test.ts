import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { code, walk } from './files'

const LIB = fileURLToPath(new URL('../src/lib', import.meta.url))
const EDITOR = fileURLToPath(new URL('../../../packages/editor/src', import.meta.url))

const read = (path: string) => readFileSync(path, 'utf8')

test('a person picture address is built in one place, from a checked hash', () => {
  const builders = walk(LIB, code)
    .filter((path) => /\/i\/\$\{[^}]*\}\.webp/.test(read(path)))
    .map((path) => relative(LIB, path).replaceAll('\\', '/'))
  expect(builders).toEqual(['accounts/src/client.ts'])
})

test('every person picture falls back when it fails to load, never showing a broken picture', () => {
  const pictures = walk(LIB, code)
    .filter((path) => path.endsWith('.svelte'))
    .flatMap((path) => {
      const text = read(path)
      const file = relative(LIB, path).replaceAll('\\', '/')
      const tags = [...text.matchAll(/<img\b[\s\S]*?\/>/g)].map((tag) => tag[0])
      const faces = text.includes('faceUrl(') ? tags : tags.filter((tag) => /src=\{[^}]*face/.test(tag))
      return faces.map((tag) => ({ file, tag }))
    })
  expect([...new Set(pictures.map((one) => one.file))]).toEqual(
    expect.arrayContaining([
      'accounts/src/AccountBadge.svelte',
      'tab-strip/src/Tabs.svelte',
      'accounts-ui/src/Avatar.svelte',
    ]),
  )
  expect(pictures.filter((one) => !one.tag.includes('onerror'))).toEqual([])
})

test('no face is painted as a background, where a failed load leaves an empty circle', () => {
  const painted = [...walk(LIB, code), ...walk(EDITOR, code)]
    .filter((path) => /backgroundImage = `url\("\$\{this\.face|background-image=\{[^}]*face/.test(read(path)))
    .map((path) => relative(join(LIB, '../../..'), path).replaceAll('\\', '/'))
  expect(painted).toEqual([])
})

test('a caret face that fails to load is dropped from the label', () => {
  expect(read(join(EDITOR, 'carets.ts'))).toMatch(/face\.onerror = \(\) => face\.remove\(\)/)
})
