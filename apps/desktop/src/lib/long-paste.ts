const LONG_PASTE = 100_000

export function longPaste(event: ClipboardEvent, least = LONG_PASTE): string | null {
  if (event.clipboardData?.files.length) return null
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (text.length < least) return null
  event.preventDefault()
  return text
}
