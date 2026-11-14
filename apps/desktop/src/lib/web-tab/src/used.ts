export function movedOn(landed: string | null, url: string | null): boolean {
  if (landed === null || url === null) return false
  return withoutFragment(url) !== withoutFragment(landed)
}

function withoutFragment(url: string): string {
  const at = url.indexOf('#')
  return at === -1 ? url : url.slice(0, at)
}
