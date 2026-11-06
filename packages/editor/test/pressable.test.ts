import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(dir: string): string[] {
  const out: string[] = []

  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path)
  }

  return out
}

const files = sourceFiles(SOURCE).map((path) => ({
  name: path.slice(SOURCE.length).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}))

function outOfTheTabOrder(text: string): boolean {
  return text.includes('tabIndex = -1')
}

describe('a button the editor draws into a note', () => {
  test('the scan finds the files', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  test('is pressed by a key as well as by a mouse', () => {
    const deaf = files
      .filter((one) => one.text.includes("createElement('button')"))
      .filter((one) => !outOfTheTabOrder(one.text))
      .filter((one) => !/pressedByKey|addEventListener\('click'/.test(one.text))
      .map((one) => one.name)

    expect(deaf, `these draw a button no key can press: ${deaf.join(', ')}`).toEqual([])
  })

  test('and says so in one place rather than in eight', () => {
    const own = files.filter((one) => one.text.includes('export function pressedByKey'))
    expect(own.map((one) => one.name)).toEqual(['press.ts'])
  })
})
