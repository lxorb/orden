import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { mermaidParser } from './mermaid'

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
  test.each([
    ['graph TD', 'definitionKeyword', 'graph'],
    ['sequenceDiagram', 'definitionKeyword', 'sequenceDiagram'],
    ['stateDiagram-v2', 'definitionKeyword', 'stateDiagram-v2'],
    ['subgraph one', 'keyword', 'subgraph'],
    ['participant Alice', 'keyword', 'participant'],
    ['end', 'keyword', 'end'],
    ['A --> B', 'operator', '-->'],
    ['A --- B', 'operator', '---'],
    ['A ==> B', 'operator', '==>'],
    ['A[1]', 'bracket', '['],
    ['A[1]', 'number', '1'],
    ['graph TD', 'variableName', 'TD'],
  ])('%j', (input, wanted, extra) => expect(typeOf(input, extra)).toEqual(wanted))

  test('marks it only at the top, so a node called graph stays a node', () => {
    const streamParser = mermaidParser
    const state = streamParser.startState!(2)

    const first = new StringStream('graph TD', 2, 2)
    streamParser.token(first, state)

    const second = new StringStream('graph', 2, 2)
    expect(streamParser.token(second, state)).toBe('variableName')
  })

  test('marks labels and comments', () => {
    expect(typeOf('A["a label"]', '"a label"')).toBe('string')
    expect(tokens('%% a comment')[0]?.[1]).toBe('comment')
  })

  test('always moves forward, whatever it is given', () => {
    for (const line of ['', '~~~', '   ', '「」', '"unclosed', 'A-->'])
      expect(() => tokens(line)).not.toThrow()
  })
})
