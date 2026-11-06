import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

function writersOf(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []

  for (const match of source.matchAll(/export function (\w+)\(([\s\S]*?)\n\}/g)) {
    const [, name = '', body = ''] = match
    if (body.includes("setProperty('--")) out.push({ name, body })
  }

  return out
}

describe('settings that change the shape of the text', () => {
  const modes = read('../src/modes.ts')

  test('the scan finds them', () => {
    expect(
      writersOf(modes)
        .map((one) => one.name)
        .sort(),
    ).toEqual(['setLineHeight', 'setMeasure'])
  })

  test('every one tells the editor to measure again', () => {
    const silent = writersOf(modes)
      .filter((one) => !one.body.includes('remeasure('))
      .map((one) => one.name)

    expect(silent, `these would leave the caret misplaced: ${silent.join(', ')}`).toEqual([])
  })

  test('remeasure exists and guards a torn-down view', () => {
    expect(modes).toContain('export function remeasure')
    expect(modes).toContain('view.dom.isConnected')
  })
})
