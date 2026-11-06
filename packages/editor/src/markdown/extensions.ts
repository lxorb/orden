import { GFM, type MarkdownConfig, parser } from '@lezer/markdown'
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

export const NoSetextHeadings: MarkdownConfig = { remove: ['SetextHeading'] }

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
  NoSetextHeadings,
]

export const nibMarkdownParser = parser.configure([GFM, ...nibMarkdownExtensions])
