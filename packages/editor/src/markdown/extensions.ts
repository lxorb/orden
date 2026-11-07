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

export const ordenMarkdownExtensions = [
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

export const ordenMarkdownParser = parser.configure([GFM, ...ordenMarkdownExtensions])
