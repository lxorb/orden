export function message(error: unknown, fallback: string): string {
  const text = error instanceof Error && !(error instanceof TypeError) ? error.message : ''
  return text || fallback
}
