const CODE = /```[\s\S]*?```|`[^`\n]+`/g

function outsideCode(text: string, change: (plain: string) => string): string {
  let out = ''
  let at = 0
  for (const found of text.matchAll(CODE)) {
    out += change(text.slice(at, found.index)) + found[0]
    at = found.index + found[0].length
  }
  return out + change(text.slice(at))
}

function marked(marker: string, inner = '[^\\s]|[^\\s][^\\n]*?[^\\s]'): RegExp {
  const quoted = marker.replace(/[*~_]/g, (one) => `\\${one}`)
  return new RegExp(
    `(^|[\\s([{"'.,;:!?-])${quoted}(${inner})${quoted}(?=$|[\\s)\\]}"'.,;:!?-])`,
    'gm',
  )
}

const BOLD = marked('*')
const STRUCK = marked('~')

export function markdownOf(text: string): string {
  return outsideCode(text, (plain) => plain.replace(BOLD, '$1**$2**').replace(STRUCK, '$1~~$2~~'))
}

const MD_BOLD = marked('**')
const MD_BOLD_UNDER = marked('__')
const MD_ITALIC = marked('*')
const MD_STRUCK = marked('~~')
const HELD = '\u0000'

export function whatsappOf(text: string): string {
  return outsideCode(text, (plain) =>
    plain
      .replace(MD_BOLD, `$1${HELD}$2${HELD}`)
      .replace(MD_BOLD_UNDER, `$1${HELD}$2${HELD}`)
      .replace(MD_ITALIC, '$1_$2_')
      .replace(MD_STRUCK, '$1~$2~')
      .replaceAll(HELD, '*'),
  )
}
