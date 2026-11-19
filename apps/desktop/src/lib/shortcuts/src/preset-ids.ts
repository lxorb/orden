import type { KeyOverrides } from '@orden/editor'
import type { Platform } from '../../ui-kit/src/api'
export const PRESET_IDS = ['default', 'notion', 'obsidian', 'vscode'] as const
export type PresetId = (typeof PRESET_IDS)[number] | 'custom'
export function knownPreset(value: unknown): PresetId | null {
  if (typeof value !== 'string' || !value) return null
  if (value === 'vim') return 'default'
  if (value === 'custom' || (PRESET_IDS as readonly string[]).includes(value)) {
    return value as PresetId
  }
  return 'custom'
}
export function presetKeys(
  preset: { readonly keys: KeyOverrides; readonly mac?: KeyOverrides },
  platform: Platform,
): KeyOverrides {
  return { ...preset.keys, ...(platform === 'mac' ? preset.mac : {}) }
}
