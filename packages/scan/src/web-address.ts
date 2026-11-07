const SOURCE = /^view-source:/i

export function isWebAddress(url: string): boolean {
  const inner = url.replace(SOURCE, '')
  if (inner !== url) return !SOURCE.test(inner) && isWebAddress(inner)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  return ![
    'tauri.localhost',
    'ipc.localhost',
    'asset.localhost',
    'orden.localhost',
    'nib.localhost',
  ].includes(parsed.hostname.toLowerCase().replace(/\.+$/, ''))
}
