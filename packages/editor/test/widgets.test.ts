import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { NibWidget } from '../src/live-preview/widget'

/** Nib's widgets hold timers, listeners on the editor's own content element,
 *  and live view objects. `NibWidget` is where giving those back lives, so a
 *  widget that extends `WidgetType` directly has to remember the teardown for
 *  itself and, going by the ones that used to, will not. That is checked here
 *  rather than remembered. */

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

/** A widget that registers whatever it is told to, so what is under test is the
 *  base class's own bookkeeping rather than any real widget's drawing. The
 *  teardown map only ever uses the element as a key, so a bare object stands in
 *  for one and these tests need no DOM. */
class Example extends NibWidget {
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

  test('extends NibWidget rather than WidgetType', () => {
    const offenders = sourceFiles(SOURCE)
      // The base class is the one place that may, and must, extend it.
      .filter((path) => !path.endsWith(join('live-preview', 'widget.ts')))
      .filter((path) => /class\s+\w+\s+extends\s+WidgetType\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SOURCE.length).replace(/\\/g, '/'))

    expect(offenders, `these would desync the editor: ${offenders.join(', ')}`).toEqual([])
  })

  test('reaches the base class from its own destroy', () => {
    // A widget with work of its own to do at the end still has to let the base
    // do its part, and only the source can say whether it does.
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
    // Guards the test above: a broken path would make it pass on nothing.
    const files = sourceFiles(SOURCE)
    expect(files.some((path) => path.endsWith('widgets.ts'))).toBe(true)
    expect(files.length).toBeGreaterThan(10)
  })
})
