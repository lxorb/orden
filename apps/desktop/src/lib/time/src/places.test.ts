import { describe, expect, test } from 'vitest'
import { appIcon, appName, lightness, plateFor, siteIcon, UNSEEN } from './places'

describe('the icon and name a place is shown with', () => {
  test('a site wears its brand from the brand set, never a bare name the outline set does not have', () => {
    expect(siteIcon('github.com')).toBe('simple-icons:github')
    expect(siteIcon('mail.google.com')).toBe('simple-icons:gmail')
    expect(siteIcon('localhost')).toBeNull()
  })
  test('an app wears its brand and its brand’s name, and an unknown one its own name with a capital', () => {
    expect(appIcon('firefox')).toBe('simple-icons:firefox')
    expect(appIcon('Code')).toBe('simple-icons:visualstudiocode')
    expect(appIcon('some tool')).toBeNull()
    expect(appName('orden', 'orden')).toBe('Orden')
    expect(appName('code', 'code')).toBe('Visual Studio Code')
    expect(appName('xterm', 'xterm')).toBe('Xterm')
  })
  test('a favicon is weighed by how light its drawn pixels are, and one hard to see sits on a plate of the other tone', () => {
    const pixels = (...each: [number, number, number, number][]) => each.flat()
    expect(lightness(pixels([0, 0, 0, 255], [0, 0, 0, 255]))).toBe(0)
    expect(lightness(pixels([255, 255, 255, 255], [0, 0, 0, 0]))).toBeCloseTo(1)
    expect(lightness(pixels([0, 0, 0, 0]))).toBeNull()
    expect(plateFor(0.1, 'dark')).toBe('light')
    expect(plateFor(0.6, 'dark')).toBeNull()
    expect(plateFor(0.95, 'light')).toBe('dark')
    expect(plateFor(0.1, 'light')).toBeNull()
    expect(plateFor(null, 'dark')).toBeNull()
    expect(plateFor(UNSEEN, 'dark')).toBe('light')
    expect(plateFor(UNSEEN, 'light')).toBeNull()
  })
})
