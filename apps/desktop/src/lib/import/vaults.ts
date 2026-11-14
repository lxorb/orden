import { fromBase64, invoke, isDesktop } from '../platform/src/api'
import type { Source } from './sources'
import { tooMuch } from './sources'

export interface Vault {
  name: string
  path: string
}

interface VaultFile {
  path: string
  size: number
}

export async function vaults(): Promise<Vault[]> {
  if (!isDesktop) return []
  try {
    return await invoke<Vault[]>('obsidian_vaults')
  } catch {
    return []
  }
}

export async function vaultSources(vault: Vault): Promise<Source[]> {
  const files = await invoke<VaultFile[]>('obsidian_vault_files', { vault: vault.path })
  const bytes = files.reduce((sum, one) => sum + one.size, 0)
  if (tooMuch(bytes)) throw new Error('That export is too big to read in one go.')

  return files.map((file) => {
    let held: Promise<Uint8Array> | null = null
    const once = () =>
      (held ??= invoke<string>('read_obsidian_file', { vault: vault.path, path: file.path }).then(
        fromBase64,
        () => {
          throw new Error(`${file.path} could not be read.`)
        },
      ))

    return {
      path: file.path,
      text: async () => new TextDecoder().decode(await once()),
      bytes: once,
    }
  })
}
