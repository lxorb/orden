import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, type Extension, type StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { once } from './once'

/** The colours a code fence needs. Kept apart from the document's own styling
 *  so a code theme can be chosen without changing how prose looks. */
export interface CodePalette {
  id: string
  name: string
  keyword: string
  string: string
  number: string
  comment: string
  function: string
  type: string
  punctuation: string
  property: string
}

/** Reads the app theme's own tokens, so this one changes with the app.
 *
 *  The four the palette has no name for are named here instead, with the colour
 *  they have always been as the answer when nothing states one. That is what lets
 *  the contrast switch reach them: it states all four, and everything else here
 *  already follows tokens it states. See contrast.css in @nib/themes. */
const FOLLOW: CodePalette = {
  id: 'follow',
  name: 'Follow the theme',
  keyword: 'var(--accent)',
  string: 'var(--success)',
  number: 'var(--code-number, #e0a233)',
  comment: 'var(--muted)',
  function: 'var(--code-function, #4a8df6)',
  type: 'var(--code-type, #3fcf8e)',
  punctuation: 'var(--muted-strong)',
  property: 'var(--code-property, #7c6bf5)',
}

export const CODE_PALETTES: CodePalette[] = [
  FOLLOW,
  {
    id: 'github',
    name: 'GitHub',
    keyword: '#cf222e',
    string: '#0a3069',
    number: '#0550ae',
    comment: '#6e7781',
    function: '#8250df',
    type: '#953800',
    punctuation: '#24292f',
    property: '#0550ae',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    keyword: '#ff79c6',
    string: '#f1fa8c',
    number: '#bd93f9',
    comment: '#6272a4',
    function: '#50fa7b',
    type: '#8be9fd',
    punctuation: '#f8f8f2',
    property: '#ffb86c',
  },
  {
    id: 'solarized',
    name: 'Solarized',
    keyword: '#859900',
    string: '#2aa198',
    number: '#d33682',
    comment: '#93a1a1',
    function: '#268bd2',
    type: '#b58900',
    punctuation: '#657b83',
    property: '#cb4b16',
  },
  {
    id: 'nord',
    name: 'Nord',
    keyword: '#81a1c1',
    string: '#a3be8c',
    number: '#b48ead',
    comment: '#616e88',
    function: '#88c0d0',
    type: '#8fbcbb',
    punctuation: '#d8dee9',
    property: '#ebcb8b',
  },
]

function codeHighlightStyle(palette: CodePalette) {
  return HighlightStyle.define([
    { tag: tags.keyword, color: palette.keyword },
    { tag: [tags.string, tags.special(tags.string)], color: palette.string },
    { tag: [tags.number, tags.bool, tags.null], color: palette.number },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment],
      color: palette.comment,
      fontStyle: 'italic',
    },
    // A name where it is given, which in a key=value fence is the key: the
    // properties mode calls it `def`, and CodeMirror reads that as a defined
    // variable. Measured on 06.09.2026 against real fences: in a `.env`,
    // `.conf` or `.gitconfig` the value was coloured and the key was not,
    // because nothing here reached this tag. It also tints the name in
    // `const total` or a parameter list, which is the same thing said in a
    // language that has more to say. It stands above the function rule on
    // purpose: a function's name is given too, and it stays a function.
    { tag: tags.definition(tags.variableName), color: palette.property },
    { tag: [tags.function(tags.variableName), tags.labelName], color: palette.function },
    { tag: [tags.typeName, tags.className, tags.namespace], color: palette.type },
    { tag: [tags.operator, tags.punctuation], color: palette.punctuation },
    { tag: tags.propertyName, color: palette.property },
    { tag: tags.invalid, color: 'var(--danger)' },
    // A diff says added and removed, not keyword and string, so these two take
    // the theme's own words for it rather than a palette entry: green and red
    // are what the fence means, in every palette. Until now they were the one
    // fence a code theme left entirely grey.
    { tag: tags.inserted, color: 'var(--success)' },
    { tag: tags.deleted, color: 'var(--danger)' },
  ])
}

function paletteById(id: string): CodePalette {
  return CODE_PALETTES.find((palette) => palette.id === id) ?? FOLLOW
}

const codeTheme = new Compartment()

/** Built once per palette: reconfiguring with a freshly built highlighter drops
 *  the highlighting on screen and works it out again, and the palette is only
 *  ever one of a handful. See once.ts. */
const highlightingFor = once((id: string): Extension =>
  syntaxHighlighting(codeHighlightStyle(paletteById(id))),
)

export function codeThemeExtension(id = 'follow'): Extension {
  return codeTheme.of(highlightingFor(id))
}

/** The palette as an effect, so a pane taking another note on can put it in the
 *  same transaction as everything else it changes. */
export function codeThemeEffect(id: string): StateEffect<unknown> {
  return codeTheme.reconfigure(highlightingFor(id))
}

export function setCodeTheme(view: EditorView, id: string) {
  view.dispatch({ effects: codeThemeEffect(id) })
}
