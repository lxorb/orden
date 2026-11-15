import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { blockDecorations } from './blocks'
import { edgeBeside } from './stepping'
import { dragFreeze } from './dragging'
import { noReveal } from './reveal'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function state(doc: string, cursor = 0, readOnly = false) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        dragFreeze,
        blockDecorations,
        noReveal.of(readOnly),
      ],
    }),
  )
}

function moved(doc: string, to: number) {
  return parsed(state(doc).update({ selection: EditorSelection.cursor(to) }).state)
}

const FORMULA = 'above\n\n$$\nE = mc^2\n$$\n\nbelow\n'
const at = (doc: string, text: string) => doc.indexOf(text)

describe('a press onto a block that draws itself', () => {
  test('stops at the top of it on the way down', () => {
    const doc = FORMULA
    const blank = at(doc, '\n\n$$') + 1
    expect(edgeBeside(state(doc, blank), blank, true)).toBe(at(doc, '$$'))
  })

  test('and at the bottom of it on the way up', () => {
    const doc = FORMULA
    const blank = at(doc, '$$\n\nbelow') + 3
    expect(edgeBeside(state(doc, blank), blank, false)).toBe(at(doc, '$$\n\nbelow') + 2)
  })

  test('one line at a time, so a line clear of the block is an ordinary press', () => {
    const doc = FORMULA
    expect(edgeBeside(state(doc, 0), 0, true)).toBe(null)
    expect(edgeBeside(state(doc, at(doc, 'below')), at(doc, 'below'), false)).toBe(null)
  })

  test('never jumps over a block drawn under the caret of a note just opened for editing', () => {
    const doc = FORMULA
    const top = at(doc, '$$')
    expect(edgeBeside(state(doc, top), top, true)).not.toBe(at(doc, '$$\n\nbelow') + 2)
  })

  test('nothing where the line it aims at is ordinary text', () => {
    const doc = 'one\ntwo\nthree\n'
    expect(edgeBeside(state(doc, 0), 0, true)).toBe(null)
    expect(edgeBeside(state(doc, 5), 5, false)).toBe(null)
  })

  test('nothing off either end of the note', () => {
    const doc = FORMULA
    expect(edgeBeside(state(doc, 0), 0, false)).toBe(null)
    expect(edgeBeside(state(doc, doc.length), doc.length, true)).toBe(null)
  })

  test('nothing for the block the caret is already in, which is showing its source', () => {
    const doc = FORMULA
    const inside = at(doc, 'E = mc')
    expect(edgeBeside(moved(doc, inside), inside, false)).toBe(null)
    expect(edgeBeside(moved(doc, inside), inside, true)).toBe(null)
  })

  const META = '---\ntitle: One\n---\n\nwords\n'

  test('nothing for front matter, which is written out as it is and has nothing to open', () => {
    const blank = at(META, '\nwords')
    expect(edgeBeside(state(META, blank), blank, false)).toBe(null)
  })
})

describe('a press across a block that never opens, as in read-only mode', () => {
  const doc = 'above\n\n$$\nx\n$$\n\nbelow'
  const top = at(doc, '$$')
  const bottom = at(doc, '$$\n\nbelow') + 2

  const pressed = (head: number, down: boolean) => edgeBeside(state(doc, head, true), head, down)

  test('still stops at the top of it on the way down', () => {
    expect(pressed(top - 1, true)).toBe(top)
  })

  test('crosses from its top to its bottom on the next press down', () => {
    expect(pressed(top, true)).toBe(bottom)
  })

  test('then leaves it to the ordinary press below', () => {
    expect(pressed(bottom, true)).toBe(null)
  })

  test('crosses from its bottom to its top on the next press up', () => {
    expect(pressed(bottom + 1, false)).toBe(bottom)
    expect(pressed(bottom, false)).toBe(top)
  })

  test('then leaves it to the ordinary press above', () => {
    expect(pressed(top, false)).toBe(null)
  })

  test('walks the whole note without ever pressing in place', () => {
    const stops = (start: number, down: boolean) => {
      const seen = [start]
      let head = start
      for (let press = 0; press < 10; press++) {
        const edge = pressed(head, down)
        if (edge === null) break
        expect(edge).not.toBe(head)
        head = edge
        seen.push(head)
      }
      return seen
    }
    expect(stops(top - 1, true)).toEqual([top - 1, top, bottom])
    expect(stops(bottom + 1, false)).toEqual([bottom + 1, bottom, top])
  })
})
