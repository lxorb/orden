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
import { highlightedFence } from '@orden/markdown/highlight'

const typescript = javascript.configure({ dialect: 'ts' })
const jsx = javascript.configure({ dialect: 'jsx' })
const tsx = javascript.configure({ dialect: 'jsx ts' })
const indentedSass = sass.configure({ dialect: 'indented' })

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

export function blogFence(code: string, language: string): string | null {
  const parser = GRAMMARS[language.toLowerCase()]
  return parser ? highlightedFence(code, language, parser) : null
}

export const COLOURED = Object.keys(GRAMMARS)
