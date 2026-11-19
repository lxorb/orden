import type { MarkedExtension, TokenizerExtension } from 'marked'
import { firstStart, lineStart, matchesAt } from './starts'

const MATH_BLOCK = /\$\$(?:\r?\n[\s\S]+?\r?\n|(?![\s$])[^\n]*?(?<![\s$]))\$\$[ \t]*(?:\r?\n|$)/y
function mathBlock(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(MATH_BLOCK, src, at) ? line : null
}
export const blockMath: TokenizerExtension = {
  name: 'blockMath',
  level: 'block',
  start: (src: string) => firstStart(src, ['$$'], mathBlock),
  tokenizer(src: string) {
    const match = /^\$\$(?:\r?\n([\s\S]+?)\r?\n|(?![\s$])([^\n]*?)(?<![\s$]))\$\$[ \t]*(?:\r?\n|$)/.exec(src)
    if (!match) return undefined
    return { type: 'blockMath', raw: match[0], text: match[1] ?? match[2] }
  },
}
const OPENS_BLOCK =
  /^(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|\||`{3,}|~{3,}|\$\$|<|\[[^\]]*\]:|(?:[-*_][ \t]*){3,}$)/
export const definitionList: TokenizerExtension = {
  name: 'definitionList',
  level: 'block',
  tokenizer(src: string) {
    const block = /^((?:[^\n:][^\n]*\n(?:[ \t]{0,3}:[ \t]+[^\n]*(?:\n|$))+)+)/.exec(src)?.[1]
    if (block === undefined) return undefined
    const items: { term: string; details: string[] }[] = []
    for (const line of block.split('\n')) {
      if (!line.trim()) continue
      const detail = /^[ \t]{0,3}:[ \t]+(.*)$/.exec(line)
      if (detail) items.at(-1)?.details.push(detail[1] ?? '')
      else items.push({ term: line.trim(), details: [] })
    }
    if (!items.length || items.some((item) => !item.details.length)) return undefined
    if (items.some((item) => OPENS_BLOCK.test(item.term))) return undefined
    return {
      type: 'definitionList',
      raw: block,
      items: items.map((item) => ({
        term: this.lexer.inlineTokens(item.term),
        details: item.details.map((detail) => this.lexer.inlineTokens(detail)),
      })),
    }
  },
}
export const noSetextHeadings: MarkedExtension = {
  tokenizer: {
    lheading: () => undefined,
  },
}
const LONE_PICTURE = /^ {0,3}<img\b(?:"[^"\n]*"|'[^'\n]*'|[^'">\n])*>[ \t]*(?:\n|$)/i
export const picturesAsWords: MarkedExtension = {
  tokenizer: {
    html: (src: string) => (LONE_PICTURE.test(src) ? undefined : false),
  },
}
