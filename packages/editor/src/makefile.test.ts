import { describe, expect, test } from 'vitest'
import { StringStream } from '@codemirror/language'
import { makefileParser } from './makefile'

/** The tokens a makefile produces, as `[text, type]` pairs, whitespace left
 *  out. The state carries over from line to line the way it does in the
 *  editor, because in a makefile the previous line is what decides whether
 *  this one is shell. */
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
  test('names the targets', () => {
    expect(typeOf('build: main.o', 'build')).toBe('labelName')
    expect(typeOf('%.o: %.c', '%.o')).toBe('labelName')
    expect(typeOf('.PHONY: build clean', '.PHONY')).toBe('labelName')
  })

  test('marks the variables, wherever they are being set', () => {
    expect(typeOf('CC = gcc', 'CC')).toBe('propertyName')
    expect(typeOf('CFLAGS += -Wall', 'CFLAGS')).toBe('propertyName')
    expect(typeOf('SHELL := /bin/sh', 'SHELL')).toBe('propertyName')
    expect(typeOf('CC = gcc', '=')).toBe('operator')
  })

  test('marks the variables being read, brackets and all', () => {
    expect(typeOf('all: $(OBJECTS)', '$(OBJECTS)')).toBe('propertyName')
    expect(typeOf('x := $(dir $(FILE))', '$(dir $(FILE))')).toBe('propertyName')
    expect(typeOf('y := ${HOME}', '${HOME}')).toBe('propertyName')
  })

  test('marks the directives', () => {
    expect(typeOf('ifeq ($(OS),Windows_NT)', 'ifeq')).toBe('keyword')
    expect(typeOf('include config.mk', 'include')).toBe('keyword')
    expect(typeOf('endif', 'endif')).toBe('keyword')
  })

  test('marks comments', () => {
    expect(tokens('# how to build')[0][1]).toBe('comment')
    expect(typeOf('build: # the default', '# the default')).toBe('comment')
  })

  /** The tab is the whole difference between make and the shell it calls, and
   *  a recipe read as make turns every `:` and `=` in a command line into
   *  punctuation that is not there. */
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
