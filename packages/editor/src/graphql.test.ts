import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { graphqlParser } from './graphql'

/** The tokens a document produces, as `[text, type]` pairs, whitespace left
 *  out. The state carries from line to line, as a block string does. */
function tokens(document: string): [string, string | null][] {
  const state = graphqlParser.startState!(2)
  const out: [string, string | null][] = []

  for (const line of document.split('\n')) {
    const stream = new StringStream(line, 2, 2)

    while (!stream.eol()) {
      const start = stream.pos
      const type = graphqlParser.token(stream, state)
      const text = line.slice(start, stream.pos)

      if (stream.pos === start) throw new Error('token consumed nothing')
      if (text.trim()) out.push([text, type])
    }
  }

  return out
}

const typeOf = (document: string, text: string) =>
  tokens(document).find(([token]) => token === text)?.[1]

describe('highlighting a graphql fence', () => {
  test('marks the words that open a definition', () => {
    expect(typeOf('type User {', 'type')).toBe('keyword')
    expect(typeOf('query Hero {', 'query')).toBe('keyword')
    expect(typeOf('fragment Fields on User {', 'fragment')).toBe('keyword')
    expect(typeOf('fragment Fields on User {', 'on')).toBe('keyword')
  })

  test('a type is named where a type belongs', () => {
    expect(typeOf('type User {', 'User')).toBe('typeName')
    expect(typeOf('fragment Fields on User {', 'User')).toBe('typeName')
    expect(typeOf('  id: ID!', 'ID')).toBe('typeName')
    expect(typeOf('  posts: [Post!]!', 'Post')).toBe('typeName')
  })

  test('and everything else in that position is a field', () => {
    expect(typeOf('  id: ID!', 'id')).toBe('propertyName')
    expect(typeOf('  posts: [Post!]!', 'posts')).toBe('propertyName')
  })

  test('marks variables and directives', () => {
    expect(typeOf('query Hero($id: ID!) {', '$id')).toBe('variableName.special')
    expect(typeOf('  name @include(if: $yes)', '@include')).toBe('variableName.function')
  })

  test('marks comments, strings and numbers', () => {
    expect(tokens('# a comment')[0][1]).toBe('comment')
    expect(typeOf('  name(first: "abc")', '"abc"')).toBe('string')
    expect(typeOf('  name(first: 10)', '10')).toBe('number')
    expect(typeOf('  name(all: true)', 'true')).toBe('atom')
  })

  test('a block string runs to its closing quotes and no further', () => {
    const document = '"""\nA user.\n"""\ntype User {'

    expect(typeOf(document, 'A user.')).toBe('string')
    expect(typeOf(document, 'type')).toBe('keyword')
    expect(typeOf(document, 'User')).toBe('typeName')
  })

  test('always moves forward, whatever it is given', () => {
    for (const line of ['', '   ', '{}', '$', '@', '...', '"""', '"unclosed', '「」']) {
      expect(() => tokens(line)).not.toThrow()
    }
  })
})
