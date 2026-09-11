/** Colouring a fence on a published page.
 *
 *  The editor colours code with CodeMirror, which needs a browser, and an export
 *  colours it with whichever of the hundred and forty-three grammars
 *  `@codemirror/language-data` loads for the fence. Neither is available here: a
 *  Worker has no DOM, and a page is rendered while the reader waits, so nothing
 *  can be fetched on the way.
 *
 *  So the Worker carries the grammars themselves. They are the very parsers the
 *  editor uses - `@codemirror/lang-javascript` is a wrapper around
 *  `@lezer/javascript` - and the colouring is @nib/markdown/highlight, the same
 *  module the export calls, writing the same `hl-` classes that themes/document.css
 *  colours. A fence on a published page is therefore the fence in the reading
 *  view, character for character.
 *
 *  Thirteen grammars rather than all of them: these are the ones with a Lezer
 *  parser of their own, which is what can be carried without a CodeMirror around
 *  it. The rest of the list - shell, SQL, Ruby, Swift and the other hundred - are
 *  stream parsers that only exist inside the editor, and a fence naming one stays
 *  plain rather than being coloured differently here than there. Whatever is
 *  added to this table is a fence that starts coming out coloured; nothing else
 *  changes.
 *
 *  A note's own marker - ` ```chart ` - and a diagram are not code and are not
 *  here: the renderer draws a chart itself, and a diagram needs a drawing library
 *  and a DOM, so it stays a code block. See docs/publishing.md. */

import type { Parser } from '@lezer/common'
import { parser as cpp } from '@lezer/cpp'
import { parser as css } from '@lezer/css'
import { parser as go } from '@lezer/go'
import { parser as html } from '@lezer/html'
import { parser as java } from '@lezer/java'
import { parser as javascript } from '@lezer/javascript'
import { parser as json } from '@lezer/json'
import { parser as php } from '@lezer/php'
import { parser as python } from '@lezer/python'
import { parser as rust } from '@lezer/rust'
import { parser as sass } from '@lezer/sass'
import { parser as xml } from '@lezer/xml'
import { parser as yaml } from '@lezer/yaml'
import { highlightedFence } from '@nib/markdown/highlight'

/** TypeScript and JSX are the JavaScript grammar in another dialect, which is
 *  exactly what `@codemirror/lang-javascript` asks it for. */
const typescript = javascript.configure({ dialect: 'ts' })
const jsx = javascript.configure({ dialect: 'jsx' })
const tsx = javascript.configure({ dialect: 'jsx ts' })
/** Sass's older, indented syntax; `.scss` is the default one. */
const indentedSass = sass.configure({ dialect: 'indented' })

/** Every word a fence may be opened with, and the grammar it names.
 *
 *  The spellings are the editor's own: a language's name, the aliases
 *  `@codemirror/language-data` knows it by, and the file extensions people
 *  actually type, which is `SPELLINGS` in @nib/editor. Kept as one flat table
 *  because that is what the lookup is - a fence says one word. */
const GRAMMARS: Readonly<Record<string, Parser>> = {
  javascript,
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  es6: javascript,
  node: javascript,
  nodejs: javascript,
  typescript,
  ts: typescript,
  mts: typescript,
  cts: typescript,
  jsx,
  tsx,

  python,
  py: python,
  py3: python,
  python3: python,
  starlark: python,
  bzl: python,
  bazel: python,

  json,
  jsonc: json,
  jsonl: json,
  ndjson: json,
  geojson: json,

  css,
  scss: sass,
  sass: indentedSass,

  html,
  htm: html,
  handlebars: html,
  hbs: html,
  mustache: html,
  erb: html,
  ejs: html,
  astro: html,

  xml,
  svg: xml,
  xsl: xml,
  xslt: xml,
  plist: xml,
  xaml: xml,

  yaml,
  yml: yaml,

  rust,
  rs: rust,

  go,
  golang: go,

  java,

  c: cpp,
  h: cpp,
  ino: cpp,
  cpp,
  'c++': cpp,
  cc: cpp,
  cxx: cpp,
  hpp: cpp,
  hh: cpp,
  hxx: cpp,
  'h++': cpp,
  cuda: cpp,
  metal: cpp,

  php,
}

/** A fence, coloured, or null to leave it as the plain block marked writes.
 *
 *  What the renderer's `code` option takes; the reading view and an export hand
 *  it the same shape. See `prepareFences` in apps/desktop/src/lib/export.ts. */
export function blogFence(code: string, language: string): string | null {
  const parser = GRAMMARS[language.toLowerCase()]
  return parser ? highlightedFence(code, language, parser) : null
}

/** Which words this Worker can colour. For the test that holds the table to the
 *  editor's spellings, and for nothing else. */
export const COLOURED = Object.keys(GRAMMARS)
