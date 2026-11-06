const TITLED = /^title\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/i

const FIRST_WORD = /^\S+/

export function languageIn(info: string): string {
  return FIRST_WORD.exec(info.trim())?.[0] ?? ''
}

export function captionIn(info: string): string {
  const trimmed = info.trim()
  const rest = trimmed.slice(languageIn(trimmed).length).trim()
  const titled = TITLED.exec(rest)

  return titled ? (titled[1] ?? titled[2] ?? titled[3] ?? '') : rest
}
