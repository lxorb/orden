import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const SOURCE = fileURLToPath(new URL('../src/', import.meta.url))

export const code = (path: string) => /\.(ts|svelte)$/.test(path) && !path.endsWith('.test.ts')
export const svelte = (path: string) => path.endsWith('.svelte')

export function walk(dir: string, keep: (path: string) => boolean, skip: string[] = []): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((one) => {
    const path = join(dir, one.name)
    if (one.isDirectory()) return skip.includes(one.name) ? [] : walk(path, keep, skip)
    return keep(path) ? [path] : []
  })
}
