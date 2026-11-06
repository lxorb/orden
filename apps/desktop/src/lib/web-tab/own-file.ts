import { readWebFile, rewriteShortcut } from '@orden/scan/shortcut'

export function withOwn(
  path: string,
  text: string | null,
  own: string | null,
  fallback = '',
): string | null {
  const said = readWebFile(path, text)
  if (!said || /\.webloc$/i.test(path.trim())) return null
  return rewriteShortcut(said, { own }, fallback)
}
