export function troubleOf(error: unknown, path: string, otherwise = 'Could not be read.'): string {
  const said = error instanceof Error ? error.message.trim() : typeof error === 'string' ? error.trim() : ''
  const rest = said.startsWith(`${path} `) ? said.slice(path.length + 1) : said
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : otherwise
}
