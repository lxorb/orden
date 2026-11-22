export async function fingerprint(secret: string): Promise<string> {
  const said = new TextEncoder().encode(`nib ai vault ${secret}`)
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', said))
  return [...digest.slice(0, 16)].map((one) => one.toString(16).padStart(2, '0')).join('')
}
