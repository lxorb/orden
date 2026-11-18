import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { expect, test } from 'vitest'
import { SOURCE, svelte, walk } from './files'

function pictures(text: string): string[] {
  return [...text.matchAll(/<img\b[\s\S]*?\/>/g)].map((one) => one[0])
}

const found = walk(SOURCE, svelte).flatMap((path) =>
  pictures(readFileSync(path, 'utf8')).map((tag) => ({ file: relative(SOURCE, path), tag })),
)

test('the app draws pictures, so this is looking at something', () => {
  expect(found.map((one) => one.file.replaceAll('\\', '/'))).toEqual(
    expect.arrayContaining(['lib/marks/src/TabMark.svelte', 'lib/marks/src/FileMark.svelte']),
  )
})

test('and none of them drags on its own', () => {
  const loose = found.filter((one) => !one.tag.includes('draggable="false"'))
  expect(loose.map((one) => `${one.file}: ${one.tag}`)).toEqual([])
})
