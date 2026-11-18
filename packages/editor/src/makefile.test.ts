import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { makefileParser } from './makefile'

function tokens(makefile: string): [string, string | null][] {
  const state = makefileParser.startState!(2)
  const out: [string, string | null][] = []

  for (const line of makefile.split('\n')) {
    const stream = new StringStream(line, 2, 2)

    while (!stream.eol()) {
      const start = stream.pos
      const type = makefileParser.token(stream, state)
      const text = line.slice(start, stream.pos)

      if (stream.pos === start) throw new Error('token consumed nothing')
      if (text.trim()) out.push([text, type])
    }
  }

  return out
}

const typeOf = (makefile: string, text: string) =>
  tokens(makefile).find(([token]) => token === text)?.[1]

describe('highlighting a makefile fence', () => {
  test.each([
    ['build: main.o', 'labelName', 'build'],
    ['%.o: %.c', 'labelName', '%.o'],
    ['.PHONY: build clean', 'labelName', '.PHONY'],
    ['CC = gcc', 'propertyName', 'CC'],
    ['CFLAGS += -Wall', 'propertyName', 'CFLAGS'],
    ['SHELL := /bin/sh', 'propertyName', 'SHELL'],
    ['CC = gcc', 'operator', '='],
    ['all: $(OBJECTS)', 'propertyName', '$(OBJECTS)'],
    ['x := $(dir $(FILE))', 'propertyName', '$(dir $(FILE))'],
    ['y := ${HOME}', 'propertyName', '${HOME}'],
    ['ifeq ($(OS),Windows_NT)', 'keyword', 'ifeq'],
    ['include config.mk', 'keyword', 'include'],
    ['endif', 'keyword', 'endif'],
  ])('%j', (input, wanted, extra) => expect(typeOf(input, extra)).toEqual(wanted))

  test('marks comments', () => {
    expect(tokens('# how to build')[0]?.[1]).toBe('comment')
    expect(typeOf('build: # the default', '# the default')).toBe('comment')
  })

  test('leaves a recipe line to the shell', () => {
    const recipe = 'build:\n\t$(CC) -o app main.c\n'

    expect(typeOf(recipe, 'build')).toBe('labelName')
    expect(typeOf(recipe, '$(CC)')).toBe('propertyName')
    expect(typeOf(recipe, '-o')).toBeNull()
  })

  test('a colon in a recipe is not a target', () => {
    const recipe = 'deploy:\n\techo "a: b" > out\n'

    expect(typeOf(recipe, 'echo')).toBeNull()
    expect(typeOf(recipe, '"a: b"')).toBe('string')
  })

  test('goes back to reading make at the next unindented line', () => {
    const makefile = 'a:\n\techo hi\nb: c\n'

    expect(typeOf(makefile, 'b')).toBe('labelName')
  })

  test('always moves forward, whatever it is given', () => {
    for (const line of ['', '\t', '   ', '$', '$(', ':::', '「」', '"unclosed', '#']) {
      expect(() => tokens(line)).not.toThrow()
    }
  })
})
