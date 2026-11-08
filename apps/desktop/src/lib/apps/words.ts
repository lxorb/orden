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

export function mayHost(platform: string): boolean {
  return platform === 'linux' || platform === 'windows' || platform === 'macos'
}

export interface Computer {
  id: string
  name: string
  platform: string
  current: boolean
}

export function hostChoices(
  computers: readonly Computer[],
  here: (device: string) => string,
): { id: string; label: string; primary: boolean }[] {
  return computers.map((one) => ({
    id: one.id,
    label: one.current ? here(one.name) : one.name,
    primary: one.current,
  }))
}
