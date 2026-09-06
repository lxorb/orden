import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { prismaParser } from './prisma'

/** The tokens a schema produces, as `[text, type]` pairs, whitespace left out.
 *  Each line is read with the state the last one left behind. */
function tokens(schema: string): [string, string | null][] {
  const state = prismaParser.startState!(2)
  const out: [string, string | null][] = []

  for (const line of schema.split('\n')) {
    const stream = new StringStream(line, 2, 2)

    while (!stream.eol()) {
      const start = stream.pos
      const type = prismaParser.token(stream, state)
      const text = line.slice(start, stream.pos)

      if (stream.pos === start) throw new Error('token consumed nothing')
      if (text.trim()) out.push([text, type])
    }
  }

  return out
}

const typeOf = (schema: string, text: string) =>
  tokens(schema).find(([token]) => token === text)?.[1]

describe('highlighting a prisma fence', () => {
  test('marks the word that opens a block, and names what it opens', () => {
    expect(typeOf('model User {', 'model')).toBe('definitionKeyword')
    expect(typeOf('model User {', 'User')).toBe('typeName')
    expect(typeOf('enum Role {', 'enum')).toBe('definitionKeyword')
    expect(typeOf('datasource db {', 'datasource')).toBe('definitionKeyword')
  })

  test('a field is its name and then its type', () => {
    expect(typeOf('  id Int', 'id')).toBe('propertyName')
    expect(typeOf('  id Int', 'Int')).toBe('typeName')
    expect(typeOf('  author User?', 'author')).toBe('propertyName')
    expect(typeOf('  author User?', 'User')).toBe('typeName')
    expect(typeOf('  posts Post[]', 'Post')).toBe('typeName')
  })

  test('marks the attributes', () => {
    expect(typeOf('  id Int @id', '@id')).toBe('variableName.function')
    expect(typeOf('  id Int @default(autoincrement())', '@default')).toBe('variableName.function')
    expect(typeOf('  @@unique([a, b])', '@@unique')).toBe('variableName.function')
  })

  /** `url = env("DATABASE_URL")` is a setting, not a field: what follows the
   *  `=` is a value, and reading it as a type coloured half the datasource
   *  block wrong. */
  test('a setting is a name, an equals and a value', () => {
    const block = 'datasource db {\n  provider = "postgresql"\n  url = env("DB_URL")\n}'

    expect(typeOf(block, 'provider')).toBe('propertyName')
    expect(typeOf(block, '"postgresql"')).toBe('string')
    expect(typeOf(block, 'env')).toBeNull()
  })

  test('marks comments and literals', () => {
    expect(tokens('// a note')[0]?.[1]).toBe('comment')
    expect(typeOf('  active Boolean @default(true)', 'true')).toBe('atom')
    expect(typeOf('  rank Int @default(3)', '3')).toBe('number')
  })

  test('always moves forward, whatever it is given', () => {
    for (const line of ['', '   ', '{}', '@', '//', '"unclosed', '「」', '?']) {
      expect(() => tokens(line)).not.toThrow()
    }
  })
})
