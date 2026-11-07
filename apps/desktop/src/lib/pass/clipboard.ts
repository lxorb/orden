import { sha256Hex } from '@orden/pass/digest'
import { copyText } from '../clipboard'
import { waited } from '../timing'

export interface Clipboard {
  read(): Promise<string>
  write(text: string): Promise<void>
}

const system: Clipboard = {
  read: () => navigator.clipboard.readText(),
  write: copyText,
}

let copies = 0
let copied: string | null = null

export function isPassSecret(text: string): boolean {
  return copied !== null && text !== '' && sha256Hex(text) === copied
}

async function stillHolds(digest: string, clipboard: Clipboard): Promise<boolean> {
  try {
    return sha256Hex(await clipboard.read()) === digest
  } catch {
    return true
  }
}

async function clearLater(digest: string, seconds: number, clipboard: Clipboard, copy: number) {
  await waited(seconds * 1000)
  if (copy !== copies || !(await stillHolds(digest, clipboard))) return
  await clipboard.write('').catch(() => undefined)
}

export async function copySecret(
  text: string,
  seconds: number,
  clipboard: Clipboard = system,
): Promise<void> {
  const copy = ++copies
  const digest = sha256Hex(text)
  copied = digest
  await clipboard.write(text)
  if (seconds > 0) void clearLater(digest, seconds, clipboard, copy)
}
