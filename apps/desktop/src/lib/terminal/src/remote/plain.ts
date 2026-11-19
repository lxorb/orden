const plain = new Set<string>()
export function isPlain(host: string): boolean {
  return plain.has(host)
}
export function markPlain(host: string): void {
  plain.add(host)
}
