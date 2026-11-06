import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { door } from '@orden/markdown/door'

let here: readonly LanguageDescription[] | null = null

export const fenceLanguages: () => Promise<readonly LanguageDescription[]> = door(() =>
  Promise.all([
    import('./language-spellings'),
    import('./language-modes'),
    import('./mermaid'),
  ]).then(([spellings, modes, mermaid]) => {
    here = [
      modes.plainTextDescription,
      ...spellings.spelled,
      ...modes.ADDED,
      mermaid.mermaidDescription,
    ]

    return here
  }),
)

export function fenceLanguage(info: string): LanguageDescription | null {
  if (here) return LanguageDescription.matchLanguageName(here, info, true)

  return LanguageDescription.of({ name: info, load: () => meant(info) })
}

async function meant(info: string): Promise<LanguageSupport> {
  const [known, modes] = await Promise.all([fenceLanguages(), import('./language-modes')])
  const found = LanguageDescription.matchLanguageName(known, info, true)
  if (!found) return modes.plainTextDescription.load()

  return found.support ?? found.load()
}
