import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { CODE_PALETTES, type CodePalette, fenceLanguages } from '@orden/editor'
import { everySurface } from '@orden/themes/write'

export type Parser = LanguageSupport['language']['parser']

export { highlightCode } from '@orden/markdown/highlight'

export async function loadParsers(names: Iterable<string>): Promise<Map<string, Parser>> {
  const parsers = new Map<string, Parser>()
  const known = await fenceLanguages()

  await Promise.all(
    [...new Set(names)].map(async (name) => {
      const description =
        LanguageDescription.matchLanguageName(known, name, true) ??
        LanguageDescription.matchFilename(known, `code.${name}`)
      if (!description) return

      const support = await description.load().catch(() => null)
      if (support) parsers.set(name, support.language.parser)
    }),
  )

  return parsers
}

export function paletteCss(palette: CodePalette): string {
  const colours: [string, string][] = [
    ['keyword', palette.keyword],
    ['string', palette.string],
    ['number', palette.number],
    ['comment', palette.comment],
    ['function', palette.function],
    ['type', palette.type],
    ['punctuation', palette.punctuation],
    ['property', palette.property],
    ['invalid', 'var(--danger)'],
    ['inserted', 'var(--success)'],
    ['deleted', 'var(--danger)'],
  ]

  return colours.map(([name, colour]) => `#write .hl-${name} { color: ${colour}; }`).join('\n')
}

const PALETTE_ID = 'orden-code-palette'

export function paintCodePalette(id: string) {
  const palette = CODE_PALETTES.find((one) => one.id === id) ?? CODE_PALETTES.at(0)

  let sheet = document.getElementById(PALETTE_ID)
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = PALETTE_ID
    document.head.prepend(sheet)
  }

  sheet.textContent = palette ? everySurface(paletteCss(palette)) : ''
}
