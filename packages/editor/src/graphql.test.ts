import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { graphqlParser } from './graphql'

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
  test.each([
    ['type User {', 'keyword', 'type'],
    ['query Hero {', 'keyword', 'query'],
    ['fragment Fields on User {', 'keyword', 'fragment'],
    ['fragment Fields on User {', 'keyword', 'on'],
    ['type User {', 'typeName', 'User'],
    ['fragment Fields on User {', 'typeName', 'User'],
    ['  id: ID!', 'typeName', 'ID'],
    ['  posts: [Post!]!', 'typeName', 'Post'],
    ['  id: ID!', 'propertyName', 'id'],
    ['  posts: [Post!]!', 'propertyName', 'posts'],
    ['query Hero($id: ID!) {', 'variableName.special', '$id'],
    ['  name @include(if: $yes)', 'variableName.function', '@include'],
  ])('%j', (input, wanted, extra) => expect(typeOf(input, extra)).toEqual(wanted))

  test('marks comments, strings and numbers', () => {
    expect(tokens('# a comment')[0]?.[1]).toBe('comment')
    expect(typeOf('  name(first: "abc")', '"abc"')).toBe('string')
    expect(typeOf('  name(first: 10)', '10')).toBe('number')
    expect(typeOf('  name(all: true)', 'true')).toBe('atom')
  })

  test.each([
    ['"""\nA user.\n"""\ntype User {', 'string', 'A user.'],
    ['"""\nA user.\n"""\ntype User {', 'keyword', 'type'],
    ['"""\nA user.\n"""\ntype User {', 'typeName', 'User'],
  ])('%j', (input, wanted, extra) => expect(typeOf(input, extra)).toBe(wanted))

  test('always moves forward, whatever it is given', () => {
    for (const line of ['', '   ', '{}', '$', '@', '...', '"""', '"unclosed', '「」'])
      expect(() => tokens(line)).not.toThrow()
  })
})
