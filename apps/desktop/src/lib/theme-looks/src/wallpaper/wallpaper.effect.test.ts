import { flushSync } from 'svelte'
import { beforeAll, describe, expect, test, vi } from 'vitest'

const faked = vi.hoisted(() => ({
  blurs: [] as number[],
  kept: new Map<string, unknown>(),
  theme: null as null | {
    id: string
    current: 'light' | 'dark'
    values: Record<string, unknown>
    settings: { id: string }[]
    accent: string
    previewing: boolean
    rewear: () => void
    select: (id: string) => void
    keptFor: (owner: string, id: string) => unknown
  },
}))

vi.mock('../../../theme/src/api', async () => {
  const { reactive } = await import('../../../../../test/effects/runes.svelte')
  const current: 'dark' | 'light' = 'dark'
  faked.theme = reactive({
    id: 'wallpaper',
    current,
    values: { blur: 0 },
    settings: [{ id: 'blur' }],
    accent: '#336699',
    previewing: false,
    rewear: () => undefined,
    select: (id: string) => {
      if (faked.theme) faked.theme.id = id
    },
    keptFor: (owner: string, id: string) =>
      owner === 'wallpaper' ? faked.kept.get(id) : undefined,
  })
  return { theme: faked.theme, accentColour: (colour: string) => colour }
})

vi.mock('./render', () => ({
  decode: async () => ({ image: {}, width: 800, height: 600 }),
  copyOf: async () => new Blob(['copy']),
  made: (_source: unknown, blur: number) => {
    faked.blurs.push(blur)
    return { picture: 'data:image/png;base64,', blur, tone: 'tone', size: [800, 600] }
  },
  sharp: async () => ({
    picture: new Blob(['sharp']),
    span: { least: 0, most: 1 },
    mean: '#000000',
  }),
  toneKey: () => 'tone',
}))

vi.mock('./kept', () => ({
  keepSource: async () => true,
  keptSource: async () => null,
  forgetSource: async () => true,
}))

vi.mock('./settings', () => ({
  toneOf: () => ({ saturation: 1, tint: 0, colour: '#000000' }),
}))

vi.mock('./sheet', () => ({ showPicture: () => undefined }))

let made = 0
beforeAll(() => {
  URL.createObjectURL = () => `blob:sharp-${++made}`
  URL.revokeObjectURL = () => undefined
})

const sharpCopy = () => document.documentElement.style.getPropertyValue('--wallpaper-sharp')

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve))
}

describe('the wallpaper sharp copy', () => {
  test('comes back after leaving the wallpaper theme and returning in the same scheme', async () => {
    const { wallpaper } = await import('./wallpaper.svelte')
    const theme = faked.theme
    if (!theme) throw new Error('no theme')

    expect(await wallpaper.take(new Blob(['picture']), 'dark')).toBe(true)
    flushSync()
    expect(sharpCopy()).toContain('blob:')

    theme.id = 'default'
    flushSync()
    expect(sharpCopy()).toBe('')

    theme.id = 'wallpaper'
    flushSync()
    await settled()
    expect(sharpCopy()).toContain('blob:')
  })
})

describe('a picture used as wallpaper from another theme', () => {
  test('is made at the wallpaper’s own blur, not the default', async () => {
    const { wallpaper } = await import('./wallpaper.svelte')
    const theme = faked.theme
    if (!theme) throw new Error('no theme')
    theme.id = 'glass'
    theme.values = {}
    faked.kept.set('blur', 60)
    flushSync()
    faked.blurs = []

    expect(await wallpaper.take(new Blob(['picture']), 'light')).toBe(true)
    flushSync()
    await settled()

    expect(faked.blurs[0]).toBe(60)
  })
})
