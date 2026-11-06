import type { ImageKind } from '@orden/online/wire'

const KINDS: Record<string, ImageKind> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export function imageKindOf(type: string): ImageKind | null {
  return KINDS[type.toLowerCase()] ?? null
}

export function imageKindAt(path: string): ImageKind | null {
  const end = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase()
  return imageKindOf(`image/${end === 'jpg' ? 'jpeg' : (end ?? '')}`)
}

export function imageIn(transfer: DataTransfer | null): File | null {
  if (!transfer || transfer.getData('text/plain')) return null
  return [...transfer.files].find((file) => imageKindOf(file.type) !== null) ?? null
}

export function pasted(text: string): string {
  const trimmed = text.replace(/\s+$/, '')
  return /[\r\n]/.test(trimmed) ? text : trimmed
}

export function linesIn(text: string): number {
  return pasted(text).split(/\r\n|\r|\n/).length
}

export function asksFirst(text: string, bracketed: boolean): boolean {
  return !bracketed && linesIn(text) > 1
}

export function spokenPath(path: string, shell: string): string {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  const posix = shell.startsWith('wsl:') || shell === 'git-bash' || shell.startsWith('/')

  let spoken = path
  if (drive?.[1] !== undefined && posix) {
    const rest = (drive[2] ?? '').replace(/\\/g, '/')
    const letter = drive[1].toLowerCase()
    spoken = shell.startsWith('wsl:') ? `/mnt/${letter}/${rest}` : `/${letter}/${rest}`
  }

  if (/^[\w\-./\\:~+@%,=]+$/.test(spoken)) return spoken
  return posix ? `'${spoken.replace(/'/g, "'\\''")}'` : `"${spoken}"`
}
