import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function components(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return components(path)
    return name.endsWith('.svelte') ? [path] : []
  })
}

function pictures(text: string): string[] {
  return [...text.matchAll(/<img\b[\s\S]*?\/>/g)].map((one) => one[0])
}

const found = components(SOURCE).flatMap((path) =>
  pictures(readFileSync(path, 'utf8')).map((tag) => ({ file: relative(SOURCE, path), tag })),
)

test('the app draws pictures, so this is looking at something', () => {
  expect(found.map((one) => one.file.replaceAll('\\', '/'))).toEqual(
    expect.arrayContaining(['lib/TabMark.svelte', 'lib/FileMark.svelte']),
  )
})

test('and none of them drags on its own', () => {
  const loose = found.filter((one) => !one.tag.includes('draggable="false"'))
  expect(loose.map((one) => `${one.file}: ${one.tag}`)).toEqual([])
})
