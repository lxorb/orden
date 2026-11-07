import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { OrdenWidget } from '../src/live-preview/widget'

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

class Example extends OrdenWidget {
  toDOM() {
    return {} as HTMLElement
  }

  take(dom: HTMLElement, undo: () => void) {
    this.onDestroy(dom, undo)
  }
}

describe('every widget', () => {
  test('gives back what it took, in the order it took it', () => {
    const order: number[] = []
    const widget = new Example()
    const dom = widget.toDOM()

    widget.take(dom, () => order.push(1))
    widget.take(dom, () => order.push(2))
    expect(order).toEqual([])

    widget.destroy(dom)
    expect(order).toEqual([1, 2])
  })

  test('gives it back once, however often destroy is called', () => {
    let count = 0
    const widget = new Example()
    const dom = widget.toDOM()

    widget.take(dom, () => count++)
    widget.destroy(dom)
    widget.destroy(dom)

    expect(count).toBe(1)
  })

  test('keeps one drawing of a widget apart from another', () => {
    const taken: string[] = []
    const widget = new Example()
    const first = widget.toDOM()
    const second = widget.toDOM()

    widget.take(first, () => taken.push('first'))
    widget.take(second, () => taken.push('second'))

    widget.destroy(first)
    expect(taken).toEqual(['first'])

    widget.destroy(second)
    expect(taken).toEqual(['first', 'second'])
  })

  test('extends OrdenWidget rather than WidgetType', () => {
    const offenders = sourceFiles(SOURCE)
      .filter((path) => !path.endsWith(join('live-preview', 'widget.ts')))
      .filter((path) => /class\s+\w+\s+extends\s+WidgetType\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SOURCE.length).replace(/\\/g, '/'))

    expect(offenders, `these would desync the editor: ${offenders.join(', ')}`).toEqual([])
  })

  test('reaches the base class from its own destroy', () => {
    const offenders = sourceFiles(SOURCE)
      .filter((path) => !path.endsWith(join('live-preview', 'widget.ts')))
      .filter((path) => {
        const source = readFileSync(path, 'utf8')
        return /\boverride destroy\(/.test(source) && !source.includes('super.destroy(')
      })
      .map((path) => path.slice(SOURCE.length).replace(/\\/g, '/'))

    expect(offenders, `these would leak what the widget took: ${offenders.join(', ')}`).toEqual([])
  })

  test('the scan actually reaches the widget files', () => {
    const files = sourceFiles(SOURCE)
    expect(files.some((path) => path.endsWith('widgets.ts'))).toBe(true)
    expect(files.length).toBeGreaterThan(10)
  })
})
