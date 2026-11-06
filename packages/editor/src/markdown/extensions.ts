import { GFM, parser } from '@lezer/markdown'
import {
  Abbreviation,
  BlockMath,
  DefinitionList,
  Footnote,
  FrontMatter,
  Hashtag,
  Highlight,
  InlineMath,
  PercentComment,
  Wikilink,
} from './constructs'
import { FencedCode } from './fences'

export const nibMarkdownExtensions = [
  Wikilink,
  PercentComment,
  Highlight,
  InlineMath,
  BlockMath,
  Footnote,
  Hashtag,
  FrontMatter,
  DefinitionList,
  Abbreviation,
  FencedCode,
]

export const nibMarkdownParser = parser.configure([GFM, ...nibMarkdownExtensions])
