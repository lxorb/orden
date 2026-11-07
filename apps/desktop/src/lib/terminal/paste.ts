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

function control(char: string): boolean {
  const code = char.codePointAt(0) ?? 0
  return code < 0x20 || (code >= 0x7f && code <= 0x9f)
}

function typedAsIs(char: string): boolean {
  return !control(char) || char === '\t' || char === '\n' || char === '\r'
}

export function pasted(text: string): string {
  const kept = [...text].filter(typedAsIs).join('')
  const trimmed = kept.replace(/\s+$/, '')
  return /[\r\n]/.test(trimmed) ? kept : trimmed
}

export function linesIn(text: string): number {
  return pasted(text).split(/\r\n|\r|\n/).length
}

export function asksFirst(text: string, bracketed: boolean): boolean {
  return !bracketed && linesIn(text) > 1
}

type Speech = 'posix' | 'csh' | 'powershell' | 'doubled' | 'nu' | 'cmd'

function speechOf(shell: string): Speech {
  if (shell.startsWith('ssh:') || shell.startsWith('wsl:') || shell === 'git-bash') return 'posix'
  if (shell.startsWith('vs-pwsh:')) return 'powershell'
  if (shell.startsWith('vs-cmd:')) return 'cmd'
  const name = (shell.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  if (/^(pwsh|powershell)(-preview)?$/.test(name)) return 'powershell'
  if (name === 'cmd') return 'cmd'
  if (name === 'nu') return 'nu'
  if (name === 'elvish') return 'doubled'
  if (name === 'csh' || name === 'tcsh') return 'csh'
  return 'posix'
}

function unquoted(spoken: string, speech: Speech): boolean {
  const plain = speech === 'posix' || speech === 'csh' ? /^[\w\-./:~+@%,=]+$/ : /^[\w\-./\\:]+$/
  return plain.test(spoken)
}

function posixSpoken(spoken: string, csh: boolean): string {
  let out = ''
  let run = ''
  const close = () => {
    if (run) out += `'${run}'`
    run = ''
  }
  for (const char of spoken) {
    if (control(char)) {
      close()
      out += '?'
    } else if (char === "'" || char === '\\' || (csh && char === '!')) {
      close()
      out += `\\${char}`
    } else run += char
  }
  close()
  return out
}

function rawNu(spoken: string): string {
  let hashes = '#'
  while (spoken.includes(`'${hashes}`)) hashes += '#'
  return `r${hashes}'${spoken}'${hashes}`
}

export function spokenPath(path: string, shell: string): string {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  const speech = speechOf(shell)

  let spoken = path
  if (drive?.[1] !== undefined && (shell.startsWith('wsl:') || shell === 'git-bash')) {
    const rest = (drive[2] ?? '').replace(/\\/g, '/')
    const letter = drive[1].toLowerCase()
    spoken = shell.startsWith('wsl:') ? `/mnt/${letter}/${rest}` : `/${letter}/${rest}`
  }

  if (unquoted(spoken, speech)) return spoken
  if (speech === 'posix' || speech === 'csh') return posixSpoken(spoken, speech === 'csh')

  const seen = [...spoken].map((char) => (control(char) ? '?' : char)).join('')
  if (speech === 'powershell') return `'${seen.replace(/['‘’‚‛]/g, '$&$&')}'`
  if (speech === 'doubled') return `'${seen.replace(/'/g, "''")}'`
  if (speech === 'nu') return seen.includes("'") ? rawNu(seen) : `'${seen}'`
  return `"${seen.replace(/"/g, '?')}"`
}
