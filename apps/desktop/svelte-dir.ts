import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const REASSIGNED = /(?<![\w$.])([A-Za-z_$][\w$]*)\.dir = \1\.dir(?=\s*[;)])/g
const HELPER = '$$orden_dir_auto'
export const DIR_AUTO = resolve(import.meta.dirname, 'src/dir-auto.ts').replace(/\\/g, '/')
export function reassignsDir(code: string): boolean {
  return new RegExp(REASSIGNED.source).test(code)
}
export function dirOnlyWhenTextChanged(code: string, helper = DIR_AUTO): string | null {
  if (!reassignsDir(code)) return null
  const kept = code.replace(REASSIGNED, (_whole, node: string) => `${HELPER}(${node})`)
  return `${kept}\nimport { dirAuto as ${HELPER} } from ${JSON.stringify(helper)};\n`
}
export function dirOnWords(): Plugin {
  return {
    name: 'orden-dir-auto',
    enforce: 'post',
    transform(code, id) {
      if (!(id.split('?')[0] ?? id).endsWith('.svelte') || id.includes('type=style')) return null
      const kept = dirOnlyWhenTextChanged(code)
      return kept === null ? null : { code: kept, map: null }
    },
  }
}
