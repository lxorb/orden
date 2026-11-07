import { describe, expect, test } from 'vitest'
import { sequenceToMermaid } from './sequence'
import { growth, GROWS_AT_MOST } from '../../../markdown/src/growth'

const lines = (source: string) => sequenceToMermaid(source).split('\n')

describe('translating a sequence fence', () => {
  test('opens a mermaid sequence diagram', () => {
    expect(lines('A->B: hi')[0]).toBe('sequenceDiagram')
  })

  test('turns a solid arrow into a mermaid one', () => {
    expect(lines('Alice->Bob: Hello')[1]).toBe('  Alice->>Bob: Hello')
  })

  test('keeps a dashed arrow dashed', () => {
    expect(lines('Bob-->Alice: Hi back')[1]).toBe('  Bob-->>Alice: Hi back')
  })

  test('takes the open-arrow spellings too', () => {
    expect(lines('A->>B: x')[1]).toBe('  A->>B: x')
    expect(lines('A-->>B: x')[1]).toBe('  A-->>B: x')
  })

  test('carries participants over', () => {
    expect(lines('participant Alice')[1]).toBe('  participant Alice')
    expect(lines('participant A as Alice')[1]).toBe('  participant A as Alice')
  })

  test('carries notes over', () => {
    expect(lines('Note right of Bob: thinking')[1]).toBe('  Note right of Bob: thinking')
  })

  test('turns a title into mermaid’s title', () => {
    expect(lines('Title: A chat')[1]).toBe('  title A chat')
  })

  test('drops blank lines and comments', () => {
    expect(lines('\n# a comment\nA->B: x')).toEqual(['sequenceDiagram', '  A->>B: x'])
  })

  test('ignores a line it cannot read rather than emitting nonsense', () => {
    expect(lines('this is not a message')).toEqual(['sequenceDiagram'])
  })

  test('keeps a colon in the message text', () => {
    expect(lines('A->B: ratio 3:1')[1]).toBe('  A->>B: ratio 3:1')
  })

  test('trims the names around the arrow', () => {
    expect(lines('  Alice  ->  Bob : hi')[1]).toBe('  Alice->>Bob: hi')
  })

  test('takes an empty message', () => {
    expect(lines('A->B:')[1]).toBe('  A->>B: ')
  })

  test('reads a long line that is no message in time that grows with its length', () => {
    const read = (length: number) => {
      const source = [`a${'-'.repeat(length)}b`, `a:${'-'.repeat(length)}b`, 'a-b'.repeat(length)]
      for (const one of source) sequenceToMermaid(one)
    }
    expect(growth(read, 4_000)).toBeLessThan(GROWS_AT_MOST)
  }, 60_000)

  test('still reads a message whose names or words hold dashes and colons', () => {
    expect(lines('A->B-2: a: b')[1]).toBe('  A->>B-2: a: b')
    expect(lines('A-B')[1]).toBeUndefined()
    expect(lines('A-:')[1]).toBeUndefined()
  })
})
