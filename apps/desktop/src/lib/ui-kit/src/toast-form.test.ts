import { describe, expect, test } from 'vitest'
import { swipedAway, toastForm } from './toast-form'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36'
describe('the form a toast takes (#2467)', () => {
  test('is the desktop one everywhere but a phone', () => {
    for (const device of ['desktop', 'tablet'] as const) {
      expect(toastForm(device, 'ios', IPHONE)).toBe('desktop')
      expect(toastForm(device, '', PIXEL)).toBe('desktop')
    }
  })
  test('on a phone follows the system: the app says it, the browser tells it otherwise', () => {
    expect(toastForm('phone', 'ios', PIXEL)).toBe('ios')
    expect(toastForm('phone', 'android', IPHONE)).toBe('android')
    expect(toastForm('phone', '', IPHONE)).toBe('ios')
    expect(toastForm('phone', '', PIXEL)).toBe('android')
  })
  test('is swiped away up on an iPhone and sideways on Android, never by a nudge', () => {
    expect(swipedAway('ios', 0, -60)).toBe(true)
    expect(swipedAway('ios', 0, -20)).toBe(false)
    expect(swipedAway('ios', 0, 80)).toBe(false)
    expect(swipedAway('android', 70, 10)).toBe(true)
    expect(swipedAway('android', -70, 10)).toBe(true)
    expect(swipedAway('android', 40, 0)).toBe(false)
    expect(swipedAway('android', 60, 90)).toBe(false)
    expect(swipedAway('desktop', 200, -200)).toBe(false)
  })
})
