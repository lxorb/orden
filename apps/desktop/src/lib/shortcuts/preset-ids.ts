export const PRESET_IDS = ['default', 'notion', 'obsidian', 'vscode', 'vim'] as const

export type PresetId = (typeof PRESET_IDS)[number] | 'custom'

export function knownPreset(value: unknown): PresetId | null {
  if (typeof value !== 'string' || !value) return null
  if (value === 'custom' || (PRESET_IDS as readonly string[]).includes(value)) {
    return value as PresetId
  }

  return 'custom'
}
