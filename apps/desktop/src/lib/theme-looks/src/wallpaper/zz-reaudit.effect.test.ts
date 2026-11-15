import { flushSync } from 'svelte'
import { beforeAll, expect, test, vi } from 'vitest'

const faked = vi.hoisted(() => ({
  theme: null as null | {
    id: string
    current: 'light' | 'dark'
    values: Record<string, unknown>
    settings: { id: string }[]
    accent: string
    previewing: boolean
    rewear: () => void
    select: (id: string) => void
    keptFor: () => undefined
  },
  blurs: [] as number[],
}))

vi.mock('../../../theme/src/api', async () => {
  const { reactive } = await import('../../../../../test/effects/runes.svelte')
  const current: 'dark' | 'light' = 'dark'
  faked.theme = reactive({
    id: 'wallpaper',
    current,
    values: { blur: 60 } as Record<string, unknown>,
    settings: [{ id: 'blur' }],
    accent: '#336699',
    previewing: false,
    rewear: () => undefined,
    select: (id: string) => {
      if (!faked.theme) return
      faked.theme.id = id
      faked.theme.values = id === 'wallpaper' ? { blur: 60 } : {}
      faked.theme.settings = id === 'wallpaper' ? [{ id: 'blur' }] : []
    },
    keptFor: () => undefined,
  })
  return { theme: faked.theme, accentColour: (colour: string) => colour }
})

vi.mock('./render', () => ({
  decode: async () => ({ image: {}, width: 800, height: 600 }),
  copyOf: async () => new Blob(['copy']),
  made: (_s: unknown, blur: number) => {
    faked.blurs.push(blur)
    return { picture: 'data:image/png;base64,', blur, tone: 'tone', size: [800, 600] }
  },
  sharp: async () => ({ picture: new Blob(['sharp']), span: { least: 0, most: 1 }, mean: '#000' }),
  toneKey: () => 'tone',
}))
vi.mock('./kept', () => ({
  keepSource: async () => true,
  keptSource: async () => null,
  forgetSource: async () => true,
}))
vi.mock('./settings', () => ({ toneOf: () => ({ saturation: 1, tint: 0, colour: '#000000' }) }))
vi.mock('./sheet', () => ({ showPicture: () => undefined }))

beforeAll(() => {
  URL.createObjectURL = () => 'blob:x'
  URL.revokeObjectURL = () => undefined
})

const settled = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setTimeout(resolve, 30))
}

test('Use as wallpaper from another theme keeps the blur the wallpaper theme is set to', async () => {
  const { wallpaper } = await import('./wallpaper.svelte')
  const theme = faked.theme
  if (!theme) throw new Error('no theme')
  expect(await wallpaper.take(new Blob(['one']), 'dark')).toBe(true)
  flushSync()
  await settled()
  expect(wallpaper.held.dark?.blur).toBe(60)

  theme.select('glass')
  flushSync()
  expect(await wallpaper.take(new Blob(['two']), 'dark')).toBe(true)
  flushSync()
  await settled()
  expect(theme.id).toBe('wallpaper')
  expect(wallpaper.held.dark?.blur).toBe(60)
})
