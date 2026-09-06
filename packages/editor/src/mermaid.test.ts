import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { mermaidParser } from './mermaid'

/** The tokens one line produces, as `[text, type]` pairs, skipping whitespace. */
function tokens(line: string): [string, string | null][] {
  const streamParser = mermaidParser
  const state = streamParser.startState!(2)
  const stream = new StringStream(line, 2, 2)
  const out: [string, string | null][] = []

  while (!stream.eol()) {
    const start = stream.pos
    const type = streamParser.token(stream, state)
    const text = line.slice(start, stream.pos)

    if (stream.pos === start) throw new Error('token consumed nothing')
    if (text.trim()) out.push([text, type])
  }

  return out
}

const typeOf = (line: string, text: string) => tokens(line).find(([token]) => token === text)?.[1]

describe('highlighting a mermaid fence', () => {
  test('marks the word that opens a diagram', () => {
    expect(typeOf('graph TD', 'graph')).toBe('definitionKeyword')
    expect(typeOf('sequenceDiagram', 'sequenceDiagram')).toBe('definitionKeyword')
    expect(typeOf('stateDiagram-v2', 'stateDiagram-v2')).toBe('definitionKeyword')
  })

  test('marks it only at the top, so a node called graph stays a node', () => {
    const streamParser = mermaidParser
    const state = streamParser.startState!(2)

    const first = new StringStream('graph TD', 2, 2)
    streamParser.token(first, state)

    const second = new StringStream('graph', 2, 2)
    expect(streamParser.token(second, state)).toBe('variableName')
  })

  test('marks the structural words', () => {
    expect(typeOf('subgraph one', 'subgraph')).toBe('keyword')
    expect(typeOf('participant Alice', 'participant')).toBe('keyword')
    expect(typeOf('end', 'end')).toBe('keyword')
  })

  test('marks the arrows', () => {
    expect(typeOf('A --> B', '-->')).toBe('operator')
    expect(typeOf('A --- B', '---')).toBe('operator')
    expect(typeOf('A ==> B', '==>')).toBe('operator')
  })

  test('marks labels and comments', () => {
    expect(typeOf('A["a label"]', '"a label"')).toBe('string')
    expect(tokens('%% a comment')[0]?.[1]).toBe('comment')
  })

  test('marks brackets and numbers', () => {
    expect(typeOf('A[1]', '[')).toBe('bracket')
    expect(typeOf('A[1]', '1')).toBe('number')
  })

  test('names nodes', () => {
    expect(typeOf('graph TD', 'TD')).toBe('variableName')
  })

  test('always moves forward, whatever it is given', () => {
    for (const line of ['', '~~~', '   ', '「」', '"unclosed', 'A-->']) {
      expect(() => tokens(line)).not.toThrow()
    }
  })
})
