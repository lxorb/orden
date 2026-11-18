import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { buildDecorations } from './decorate'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const PARK = '\n\nx'

function state(doc: string) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

interface Spec {
  class?: string
  attributes?: Record<string, string>
}

function linkMarks(doc: string) {
  const full = doc + PARK
  const out: { text: string; href?: string; note?: string }[] = []
  buildDecorations(state(full)).decorations.between(0, full.length, (from, to, value) => {
    const spec = value.spec as Spec
    if (!spec.class?.split(' ').includes('orden-link')) return
    const href = spec.attributes?.['data-href']
    const note = spec.attributes?.['data-note']
    out.push({ text: full.slice(from, to), ...(href ? { href } : {}), ...(note ? { note } : {}) })
  })
  return out
}

function concealed(doc: string): string[] {
  const full = doc + PARK
  const out: string[] = []
  buildDecorations(state(full)).atomic.between(0, full.length, (from, to) => {
    out.push(full.slice(from, to))
  })
  return out
}

describe('a link whose words carry inline marks', () => {
  test('is still a link when part of its words are bold', () => {
    expect(linkMarks('see [the **best** docs](https://x.dev) now')).toEqual([
      { text: 'the **best** docs', href: 'https://x.dev' },
    ])
  })

  test('is still a link when its words are code', () => {
    expect(linkMarks('run [`npm i`](https://x.dev) first')).toEqual([
      { text: '`npm i`', href: 'https://x.dev' },
    ])
  })

  test('is still a link when it holds an escape', () => {
    expect(linkMarks('read [C\\# guide](https://x.dev) here')).toEqual([
      { text: 'C\\# guide', href: 'https://x.dev' },
    ])
  })

  test('is still a link to a note when its words are italic', () => {
    expect(linkMarks('open [*plan*](Plan.md) today')).toEqual([{ text: '*plan*', note: 'Plan.md' }])
  })

  test('is still a link around a picture, as a badge is written', () => {
    expect(linkMarks('[![build](badge.png)](https://ci.dev)')).toEqual([
      { text: '![build](badge.png)', href: 'https://ci.dev' },
    ])
  })

  test('a reference link with bold words hides its label', () => {
    expect(concealed('see [the **one**][r] here\n\n[r]: https://x.dev')).toContain('[r]')
  })

  test('bracketed words with a mark in them and nothing defined keep their brackets', () => {
    expect(concealed('he said [*sic*] it')).toEqual(['*', '*'])
  })
})
