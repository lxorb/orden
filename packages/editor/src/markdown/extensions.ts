import {
  Abbreviation,
  BlockMath,
  DefinitionList,
  Footnote,
  FrontMatter,
  Highlight,
  InlineMath,
} from './constructs'
import { FencedCode } from './fences'

/** What the markdown parser is taught on top of CommonMark and GFM.
 *
 *  The order is the order lezer-markdown applies them in, and it matters where
 *  two constructs could claim the same characters: see the `before` and `after`
 *  in each config for the pairs that do. `FencedCode` is last because it
 *  replaces the built-in parser of the same name rather than adding to it.
 *
 *  The constructs themselves are in constructs.ts, fenced code in fences.ts,
 *  the characters and tags they are written with in syntax.ts and tags.ts. */
export const nibMarkdownExtensions = [
  Highlight,
  InlineMath,
  BlockMath,
  Footnote,
  FrontMatter,
  DefinitionList,
  Abbreviation,
  FencedCode,
]
