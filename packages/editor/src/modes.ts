import {
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  Direction,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { language as currentLanguage, syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { commonmarkLanguage, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { isExternal } from './external'
import { fenceLanguage } from './languages'
import { livePreview } from './live-preview'
import { noReveal, quietMarks } from './live-preview/reveal'
import { numberEquations } from './live-preview/blocks'
import { ordenMarkdownExtensions, NoSetextHeadings } from './markdown/extensions'
import { enclosing } from './nodes'
import { flushTableEdits } from './table/widget'
import { smartPunctuation } from './typography'
import { codeThemeEffect } from './code-theme'
import { ligatures, type LigatureScope } from './ligatures'
import { once } from './once'
import { completionEffect } from './completion'
import { wrapSelection } from './wrap'
import { vimEffect, vimExtensions } from './vim'

const preview = new Compartment()
const focus = new Compartment()
const marks = new Compartment()
const typewriter = new Compartment()
const punctuation = new Compartment()
const language = new Compartment()
const equations = new Compartment()
const spelling = new Compartment()
const brackets = new Compartment()
const glyphs = new Compartment()
const readOnly = new Compartment()
const headingNumbers = new Compartment()
const codeLineNumbers = new Compartment()
const direction = new Compartment()

function editorClass(name: string): Extension {
  return EditorView.editorAttributes.of({ class: name })
}

const markdownFor = once((strict: boolean): Extension =>
  markdown({
    base: strict ? commonmarkLanguage : markdownLanguage,
    codeLanguages: fenceLanguage,
    extensions: strict ? [NoSetextHeadings] : ordenMarkdownExtensions,
    addKeymap: false,
    pasteURLAsLink: false,
  }),
)

const PARSED_AT_MOST = 512 * 1024

const NO_LANGUAGE: Extension = []

export function tooLongToParse(length: number): boolean {
  return length > PARSED_AT_MOST
}

const strictly = StateEffect.define<boolean>()

const strictness = StateField.define<boolean>({
  create: () => false,
  update: (was, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(strictly)) return effect.value
    }

    return was
  },
})

const seen = StateField.define<boolean>({ create: () => false, update: () => true })

const parseGuard = EditorState.transactionExtender.of((transaction) => {
  const was = transaction.startState
  const plain = tooLongToParse(transaction.newDoc.length)

  const crossed = plain !== tooLongToParse(was.doc.length)
  const set = transaction.effects.some((effect) => effect.is(strictly))
  if (!crossed && !set && was.field(seen, false) === true) return null

  return {
    effects: language.reconfigure(
      plain ? NO_LANGUAGE : markdownFor(strictnessAfter(was, transaction.effects)),
    ),
  }
})

function strictnessAfter(was: EditorState, effects: readonly StateEffect<unknown>[]): boolean {
  for (const effect of effects) {
    if (effect.is(strictly)) return effect.value
  }

  return was.field(strictness, false) ?? false
}

const dim = Decoration.line({ class: 'orden-dim' })

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    private build(view: EditorView): DecorationSet {
      const { state } = view
      const head = state.selection.main.head
      const block = enclosingBlock(state, head)
      const ranges = []

      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = state.doc.lineAt(pos)
          if (line.to < block.from || line.from > block.to) ranges.push(dim.range(line.from))
          if (line.to >= state.doc.length) break
          pos = line.to + 1
        }
      }

      return Decoration.set(ranges, true)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function enclosingBlock(state: EditorView['state'], pos: number) {
  let block: SyntaxNode | null = null
  for (const node of enclosing(syntaxTree(state).resolveInner(pos, -1))) {
    if (node.name !== 'Document') block = node
  }

  if (!block) {
    const line = state.doc.lineAt(pos)
    return { from: line.from, to: line.to }
  }

  return { from: block.from, to: block.to }
}

const typewriterPlugin = EditorView.updateListener.of((update) => {
  if (!update.docChanged && !update.selectionSet) return

  const view = update.view
  const head = view.state.selection.main.head
  const block = view.lineBlockAt(head)
  const middle = view.scrollDOM.clientHeight / 2
  const offset = block.top - view.scrollDOM.scrollTop - middle + block.height / 2

  if (Math.abs(offset) < 1) return
  view.scrollDOM.scrollTop += offset
})

export function modeExtensions(length = 0): Extension {
  return [
    language.of(tooLongToParse(length) ? NO_LANGUAGE : markdownFor(false)),
    strictness,
    seen,
    parseGuard,
    preview.of(previewFor(false)),
    focus.of(focusFor(false)),
    marks.of(quietMarks.of(false)),
    typewriter.of(typewriterFor(false)),
    punctuation.of(punctuationFor(false)),
    equations.of(numberEquations.of(false)),
    spelling.of(spellingFor(false)),
    brackets.of(bracketsFor(true)),
    glyphs.of(ligaturesFor('off')),
    readOnly.of(readOnlyFor(false)),
    headingNumbers.of(headingNumbersFor(false)),
    codeLineNumbers.of(codeLineNumbersFor(false)),
    direction.of(directionFor(false)),
    vimExtensions(),
  ]
}

function readOnlyExtensions(): Extension {
  return [
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    noReveal.of(true),
    EditorView.contentAttributes.of({ tabindex: '0' }),
    EditorView.editorAttributes.of({ class: 'orden-read-only' }),
    EditorState.changeFilter.of(isExternal),
  ]
}

const readOnlyFor = once((on: boolean): Extension => (on ? readOnlyExtensions() : []))

const previewFor = once((source: boolean): Extension => (source ? [] : livePreview()))

const focusFor = once((on: boolean): Extension =>
  on ? [focusPlugin, editorClass('orden-focus-mode')] : [],
)

const typewriterFor = once((on: boolean): Extension =>
  on ? [typewriterPlugin, editorClass('orden-typewriter-mode')] : [],
)

const ligaturesFor = once((scope: LigatureScope): Extension =>
  scope === 'off' ? [] : [ligatures(scope), editorClass('orden-ligatures')],
)

const punctuationFor = once((on: boolean): Extension => (on ? smartPunctuation() : []))

const headingNumbersFor = once((on: boolean): Extension =>
  on ? editorClass('orden-numbered') : [],
)

const codeLineNumbersFor = once((on: boolean): Extension =>
  on ? editorClass('orden-line-numbers') : [],
)

const bracketsFor = once((on: boolean): Extension => (on ? wrapSelection() : []))

const RIGHT_TO_LEFT =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u

const STRONG = /\p{L}/u

const OWN_DIRECTION = new Set(['FencedCode', 'CodeBlock', 'Table', 'FrontMatter', 'BlockMath'])

export function firstStrong(text: string): Direction | null {
  for (const char of text) {
    if (RIGHT_TO_LEFT.test(char)) return Direction.RTL
    if (STRONG.test(char)) return Direction.LTR
  }
  return null
}

function keepsItsOwn(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node.parent; node = node.parent) {
    if (OWN_DIRECTION.has(node.name)) return true
  }
  return false
}

const asWritten = {
  [Direction.LTR]: Decoration.line({ attributes: { dir: 'ltr' } }),
  [Direction.RTL]: Decoration.line({ attributes: { dir: 'rtl' } }),
}

function directions(view: EditorView, base: Direction): DecorationSet {
  const { state } = view
  const marks = []

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      const said = firstStrong(line.text)
      if (said !== null && said !== base && !keepsItsOwn(state, line.from)) {
        marks.push(asWritten[said].range(line.from))
      }
      if (line.to >= state.doc.length) break
      pos = line.to + 1
    }
  }

  return Decoration.set(marks)
}

function lineDirections(base: Direction): Extension {
  return [
    EditorView.perLineTextDirection.of(true),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = directions(view, base)
        }

        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = directions(update.view, base)
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ]
}

export const leftToRightLines = lineDirections(Direction.LTR)
export const rightToLeftLines = lineDirections(Direction.RTL)

const directionFor = once((rtl: boolean): Extension =>
  rtl
    ? [EditorView.contentAttributes.of({ dir: 'rtl' }), editorClass('orden-rtl'), rightToLeftLines]
    : [EditorView.contentAttributes.of({ dir: 'ltr' }), leftToRightLines],
)

const spellings = once((setting: string): Extension => {
  const language = setting.slice(setting.indexOf('|') + 1)
  return EditorView.contentAttributes.of({
    spellcheck: setting.startsWith('on|') ? 'true' : 'false',
    ...(language ? { lang: language } : {}),
  })
})

const spellingFor = (on: boolean, language?: string): Extension =>
  spellings(`${on ? 'on' : 'off'}|${language ?? ''}`)

export interface ModeSettings {
  source: boolean
  readOnly: boolean
  focus: boolean
  quietMarks: boolean
  typewriter: boolean
  punctuation: boolean
  numbers: boolean
  lineNumbers: boolean
  codeTheme: string
  rtl: boolean
  strict: boolean
  equationNumbers: boolean
  spellcheck: boolean
  dictionary?: string | undefined
  closeBrackets: boolean
  ligatures: LigatureScope
  vim: boolean
}

export function modeEffects(settings: ModeSettings): StateEffect<unknown>[] {
  flushTableEdits()

  return [
    strictly.of(settings.strict),
    language.reconfigure(markdownFor(settings.strict)),
    preview.reconfigure(previewFor(settings.source)),
    readOnly.reconfigure(readOnlyFor(settings.readOnly && !settings.source)),
    focus.reconfigure(focusFor(settings.focus)),
    marks.reconfigure(quietMarks.of(settings.quietMarks)),
    typewriter.reconfigure(typewriterFor(settings.typewriter)),
    punctuation.reconfigure(punctuationFor(settings.punctuation)),
    equations.reconfigure(numberEquations.of(settings.equationNumbers)),
    spelling.reconfigure(spellingFor(settings.spellcheck, settings.dictionary)),
    brackets.reconfigure(bracketsFor(settings.closeBrackets)),
    completionEffect(settings.closeBrackets),
    glyphs.reconfigure(ligaturesFor(settings.ligatures)),
    headingNumbers.reconfigure(headingNumbersFor(settings.numbers)),
    codeLineNumbers.reconfigure(codeLineNumbersFor(settings.lineNumbers)),
    direction.reconfigure(directionFor(settings.rtl)),
    codeThemeEffect(settings.codeTheme),
    vimEffect(settings.vim),
  ]
}

export function setStrictMode(view: EditorView, on: boolean) {
  flushTableEdits()
  view.dispatch({
    effects: [strictly.of(on), language.reconfigure(markdownFor(on))],
  })
}

export function parsedFully(state: EditorState): boolean {
  return state.facet(currentLanguage) !== null
}

export function setEquationNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: equations.reconfigure(numberEquations.of(on)) })
}

export function setSourceMode(view: EditorView, on: boolean) {
  flushTableEdits()
  view.dispatch({
    effects: on
      ? [preview.reconfigure(previewFor(true)), readOnly.reconfigure(readOnlyFor(false))]
      : preview.reconfigure(previewFor(false)),
  })
}

export function setReadOnlyMode(view: EditorView, on: boolean) {
  flushTableEdits()
  view.dispatch({
    effects: on
      ? [readOnly.reconfigure(readOnlyFor(true)), preview.reconfigure(previewFor(false))]
      : readOnly.reconfigure(readOnlyFor(false)),
  })
}

export function setFocusMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: focus.reconfigure(focusFor(on)) })
}

export function setQuietMarks(view: EditorView, on: boolean) {
  view.dispatch({ effects: marks.reconfigure(quietMarks.of(on)) })
}

export function setTypewriterMode(view: EditorView, on: boolean) {
  view.dispatch({ effects: typewriter.reconfigure(typewriterFor(on)) })
}

export function setLigatures(view: EditorView, scope: LigatureScope) {
  view.dispatch({ effects: glyphs.reconfigure(ligaturesFor(scope)) })
}

export function setSmartPunctuation(view: EditorView, on: boolean) {
  view.dispatch({ effects: punctuation.reconfigure(punctuationFor(on)) })
}

export function setHeadingNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: headingNumbers.reconfigure(headingNumbersFor(on)) })
}

export function setCodeLineNumbers(view: EditorView, on: boolean) {
  view.dispatch({ effects: codeLineNumbers.reconfigure(codeLineNumbersFor(on)) })
}

export function setMeasure(view: EditorView, rem: number) {
  view.dom.style.setProperty('--measure', `${rem}rem`)
  remeasure(view)
}

export function setLineHeight(view: EditorView, height: number) {
  view.dom.style.setProperty('--leading-content', String(height))
  remeasure(view)
}

export function remeasure(view: EditorView) {
  if (view.dom.isConnected) view.requestMeasure()
}

export function setSpellcheck(view: EditorView, on: boolean, language?: string) {
  view.dispatch({ effects: spelling.reconfigure(spellingFor(on, language)) })
}

export function setCloseBrackets(view: EditorView, on: boolean) {
  view.dispatch({ effects: [brackets.reconfigure(bracketsFor(on)), completionEffect(on)] })
}

export function setRightToLeft(view: EditorView, on: boolean) {
  view.dispatch({ effects: direction.reconfigure(directionFor(on)) })
}
