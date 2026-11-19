import { afterEach, describe, expect, test } from 'vitest'
import { registerTabKind } from '@orden/contracts'

const { tintOf, wear, wornBy } = await import('../src/icon-target')
const gone: (() => void)[] = []
afterEach(() => {
  for (const one of gone.splice(0)) one()
})
describe('the icon picker', () => {
  test('reads and wears a tab’s icon through the part its tab kind registers', async () => {
    const worn = new Map<string, [string | null, string | null]>([['t1', ['star', 'red']]])
    const { tabKindLoaded } = await import('@orden/contracts')
    gone.push(
      registerTabKind('terminal', () =>
        Promise.resolve({
          icon: {
            worn: (tab: string) => worn.get(tab)?.[0] ?? null,
            tint: (tab: string) => worn.get(tab)?.[1] ?? null,
            wear: (tab: string, icon: string | null, colour: string | null) => void worn.set(tab, [icon, colour]),
          },
        }),
      ),
    )
    await tabKindLoaded('terminal')
    const target = { kind: 'terminal', tab: 't1' } as const
    expect(wornBy(target)).toBe('star')
    expect(tintOf(target)).toBe('red')
    wear(target, 'rocket', null)
    expect(wornBy(target)).toBe('rocket')
    expect(tintOf(target)).toBeNull()
  })
  test('never wears a web icon that only names its site: a chosen icon is kept in the value itself (#2257)', () => {
    const took: (string | null)[] = []
    const target = { kind: 'pass', worn: null, take: (icon: string | null) => void took.push(icon) } as const
    wear(target, 'site:github.com', null)
    expect(took).toEqual([])
    const kept = 'data:image/png;base64,iVBORw0KGgo='
    wear(target, kept, null)
    wear(target, null, null)
    expect(took).toEqual([kept, null])
  })
})
