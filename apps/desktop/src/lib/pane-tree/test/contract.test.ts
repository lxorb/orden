import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})

const HERE = join(import.meta.dirname, '..')
const LIB = join(HERE, '..')

const own = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
  dependsOn: string[]
  pending?: string[]
}

function layerOf(name: string): string | null {
  const file = join(LIB, name, 'module.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { layer: string }).layer
}

describe('the pane tree', () => {
  test('it leans on no content or feature module', () => {
    const higher = own.dependsOn.filter((name) => {
      const layer = layerOf(name)
      return layer === 'content' || layer === 'features'
    })
    expect(higher).toEqual([])
  })
})
