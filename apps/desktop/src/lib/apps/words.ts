/** What an application's program line says (docs/apps.md): the program and its
 *  arguments, split as a shell splits them - on spaces, with quotes keeping a space in
 *  one, and a backslash keeping the next character as it is - and never run by a shell. */
export function programOf(line: string): { path: string; args: string[] } | null {
  const words: string[] = []
  let word = ''
  let started = false
  let quote: '"' | "'" | null = null
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at] ?? ''
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && at + 1 < line.length) word += line[++at] ?? ''
      else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (char === '\\' && at + 1 < line.length) {
      word += line[++at] ?? ''
      started = true
    } else if (/\s/.test(char)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote) return null
  if (started) words.push(word)
  const [path, ...args] = words
  return path ? { path, args } : null
}

/** The devices an application may run on: a computer, never a phone or a page. */
export function mayHost(platform: string): boolean {
  return platform === 'linux' || platform === 'windows' || platform === 'macos'
}
