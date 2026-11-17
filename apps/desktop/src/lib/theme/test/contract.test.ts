import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { providePort } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import {
  builtIns,
  carriedCss,
  chosenFirst,
  chrome,
  isBuiltIn,
  paintsOver,
  stamped,
  stampOf,
  theme,
  type ThemeSetting,
  valueOf,
} from '../src/api'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('nothing under src reaches the lazy half or the shell by path', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .filter((name) => /theme-looks|workspace|web-tab/.test(readFileSync(join(SRC, name), 'utf8')))
    expect(reaching).toEqual([])
  })

  test('loads with no port bound: the four built-in themes are listed and the store answers', () => {
    expect(builtIns().map((one) => one.id)).toEqual(['default', 'contrast', 'glass', 'wallpaper'])
    expect(isBuiltIn('glass')).toBe(true)
    expect(isBuiltIn('rose')).toBe(false)
    expect(theme.offers('system')).toBe(true)
    expect(chrome.on).toBe(false)
    expect(chrome.barOf('tab-1')).toBeUndefined()
  })

  test('a door into the lazy half rejects instead of throwing while no port is bound', async () => {
    const wallpaper = builtIns().find((one) => one.id === 'wallpaper')
    expect(wallpaper?.load).toBeDefined()
    await expect(wallpaper?.load?.()).rejects.toThrow(/theme\.looks/)
  })

  test('the bound port is what the built-in themes load through', async () => {
    const dial: ThemeSetting = {
      id: 'wash',
      label: 'Wash',
      hint: '',
      kind: 'range',
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      initial: 1,
      paint: () => ({}),
    }
    const unbind = providePort('theme.looks', {
      glassSettings: () => Promise.resolve(() => [dial]),
      wallpaperSheet: () => Promise.resolve(':root { --wallpaper: 1 }'),
      wallpaperSettings: () => Promise.resolve(() => []),
      wakeWallpaper: () => Promise.resolve(),
      follow: () => Promise.resolve(),
      landed: () => Promise.resolve(),
    })
    try {
      const glass = builtIns().find((one) => one.id === 'glass')
      const wallpaper = builtIns().find((one) => one.id === 'wallpaper')
      expect((await glass?.own?.())?.()).toEqual([dial])
      expect(await wallpaper?.load?.()).toBe(':root { --wallpaper: 1 }')
    } finally {
      unbind()
    }
  })
})

describe('a theme sheet', () => {
  test('puts the chosen font first in every stack it declares', () => {
    expect(chosenFirst('--font-ui: Inter;')).toBe('--font-ui: var(--font-ui-chosen,) Inter;')
    expect(chosenFirst('code { font-family: Menlo }')).toBe(
      'code { font-family: var(--font-mono-chosen,) Menlo }',
    )
    expect(chosenFirst('--font-ui: var(--font-system);')).toBe('--font-ui: var(--font-system);')
  })

  test('carries the old prefix into the new one in selectors and tokens', () => {
    expect(carriedCss('.nib-pane { --nib-x: 1 } #nib-app [class="nib-row"]')).toBe(
      '.orden-pane { --orden-x: 1 } #orden-app [class="orden-row"]',
    )
    expect(carriedCss('.nibble { color: red }')).toBe('.nibble { color: red }')
  })

  test('a stamp survives a round trip and a forged one is refused', () => {
    const stamp = { id: 'rose', name: 'Rose', author: 'Orden', version: '1.2.3' }
    const css = stamped(stamp, ':root { --bg: #fff }')
    expect(stampOf(css)).toEqual(stamp)
    expect(stampOf(':root {}')).toBeNull()
    expect(stampOf('/*! orden-theme {"id": 1} */')).toBeNull()
    expect(stamped({ ...stamp, name: 'Ro*/se' }, '').includes('*/se')).toBe(false)
  })
})

describe('a theme setting', () => {
  const size: ThemeSetting = {
    id: 'size',
    label: 'Size',
    hint: '',
    kind: 'range',
    min: 10,
    max: 20,
    step: 1,
    unit: 'px',
    initial: 14,
    paint: (value) => ({ '--size': `${String(value)}px` }),
  }
  const tone: ThemeSetting = {
    id: 'tone',
    label: 'Tone',
    hint: '',
    kind: 'choice',
    options: [{ value: 'warm', label: 'Warm' }],
    initial: 'warm',
    paint: () => ({ '--tone': 'warm' }),
  }

  test('a held value is kept inside its range or options, anything else is the initial', () => {
    expect(valueOf(size, 12)).toBe(12)
    expect(valueOf(size, 99)).toBe(20)
    expect(valueOf(size, 'big')).toBe(14)
    expect(valueOf(tone, 'warm')).toBe('warm')
    expect(valueOf(tone, 'cold')).toBe('warm')
  })

  test('a sheet that writes the token itself paints over the setting', () => {
    expect(paintsOver(':root { --size: 12px }', size)).toBe(true)
    expect(paintsOver(':root { --size: inherit }', size)).toBe(false)
    expect(paintsOver(':root { --tone: warm }', size)).toBe(false)
  })
})
