import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const { startup } = await import('../src/api')

describe('the launch order', () => {
  test('lets each stage start only once the first frame is shown, in order', async () => {
    const reached: string[] = []
    const index = startup.turn('index').then(() => reached.push('index'))
    const right = startup.turn('right').then(() => reached.push('right'))
    expect(startup.reached('index')).toBe(false)

    await startup.shown()
    await Promise.all([index, right])

    expect(reached).toEqual(['index', 'right'])
    expect(startup.reached('right')).toBe(true)
  })
})
