import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { code, walk } from './files'

const LIB = fileURLToPath(new URL('../src/lib', import.meta.url))
const SMALL = ['overview/src/mirror.ts', 'tab-strip/src/thumb.ts', 'theme-looks/src/wallpaper/render.ts']
test('a picture of any size is encoded off the window’s thread, never by toDataURL', () => {
  const found = walk(LIB, code)
    .map((path) => relative(LIB, path).replaceAll('\\', '/'))
    .filter((path) => readFileSync(join(LIB, path), 'utf8').includes('.toDataURL('))
  expect(found.filter((path) => !SMALL.includes(path))).toEqual([])
  expect(SMALL.filter((path) => !found.includes(path))).toEqual([])
})
