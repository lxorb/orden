import { afterEach, describe, expect, test } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { CheckboxWidget } from '../src/live-preview/widgets'

interface StandIn {
  type: string
  className: string
  checked: boolean
  attributes: Map<string, string>
  setAttribute(name: string, value: string): void
  addEventListener(): void
}

function standIn(): StandIn {
  return {
    type: '',
    className: '',
    checked: false,
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value)
    },
    addEventListener() {
      return undefined
    },
  }
}

const made: StandIn[] = []

Object.assign(globalThis, {
  document: {
    createElement: () => {
      const one = standIn()
      made.push(one)
      return one
    },
  },
})

afterEach(() => {
  made.length = 0
})

describe("a task's box", () => {
  test('is named for what ticking it means', () => {
    new CheckboxWidget(false, 2, 5).toDOM({} as EditorView)
    expect(made[0]?.attributes.get('aria-label')).toBe('Done')
  })
})
