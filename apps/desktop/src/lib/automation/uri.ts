const SCHEMES = ['nib:', 'web+nib:'] as const

const CALLBACK_KEYS = ['x-success', 'x-error', 'x-cancel'] as const

interface Callbacks {
  success: string | null
  error: string | null
  cancel: string | null
}

export interface Followable {
  action: string
  args: Record<string, string>
  callbacks: Callbacks
}

export function isNibUri(text: string): boolean {
  const folded = text.trim().toLowerCase()
  return SCHEMES.some((scheme) => folded.startsWith(scheme))
}

export function isFileUri(text: string): boolean {
  return text.trim().toLowerCase().startsWith('file:')
}

export function readUri(uri: string): Followable | null {
  const trimmed = uri.trim()
  const scheme = SCHEMES.find((one) => trimmed.toLowerCase().startsWith(one))
  if (!scheme) return null

  const rest = trimmed.slice(scheme.length).replace(/^\/+/, '')
  const cut = rest.indexOf('?')
  const said = (cut < 0 ? rest : rest.slice(0, cut)).replace(/\/+$/, '')
  const query = cut < 0 ? '' : rest.slice(cut + 1)

  const action = said.replace(/^x-callback-url\//i, '').toLowerCase()
  if (!/^[a-z][a-z.-]*$/.test(action)) return null

  const given: Record<string, string> = {}
  for (const [name, value] of new URLSearchParams(query)) {
    const key = name.toLowerCase()
    if (!Object.hasOwn(given, key)) given[key] = value
  }

  const callbacks: Callbacks = {
    success: given['x-success'] ?? null,
    error: given['x-error'] ?? null,
    cancel: given['x-cancel'] ?? null,
  }

  const args = Object.fromEntries(
    Object.entries(given).filter(([key]) => !CALLBACK_KEYS.some((one) => one === key)),
  )

  return { action, args, callbacks }
}

export function callbackKind(url: string | null): 'external' | 'nib' | null {
  if (!url) return null
  if (isNibUri(url)) return 'nib'

  return /^https?:\/\//i.test(url) ? 'external' : null
}

export function withOutcome(url: string, said: Record<string, string>): string {
  const cut = url.indexOf('?')
  const query = new URLSearchParams(cut < 0 ? '' : url.slice(cut + 1))

  for (const [name, value] of Object.entries(said)) query.set(name, value)

  const written = query.toString()
  const head = cut < 0 ? url : url.slice(0, cut)
  return written ? `${head}?${written}` : head
}
