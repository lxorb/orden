import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { prismaParser } from './prisma'

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
const typeOf = (schema: string, text: string) => tokens(schema).find(([token]) => token === text)?.[1]
describe('highlighting a prisma fence', () => {
  test.each([
    ['model User {', 'definitionKeyword', 'model'],
    ['model User {', 'typeName', 'User'],
    ['enum Role {', 'definitionKeyword', 'enum'],
    ['datasource db {', 'definitionKeyword', 'datasource'],
    ['  id Int', 'propertyName', 'id'],
    ['  id Int', 'typeName', 'Int'],
    ['  author User?', 'propertyName', 'author'],
    ['  author User?', 'typeName', 'User'],
    ['  posts Post[]', 'typeName', 'Post'],
    ['  id Int @id', 'variableName.function', '@id'],
    ['  id Int @default(autoincrement())', 'variableName.function', '@default'],
    ['  @@unique([a, b])', 'variableName.function', '@@unique'],
  ])('%j', (input, wanted, extra) => expect(typeOf(input, extra)).toEqual(wanted))
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
    for (const line of ['', '   ', '{}', '@', '//', '"unclosed', '「」', '?']) expect(() => tokens(line)).not.toThrow()
  })
})
