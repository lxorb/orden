import { describe, expect, test, vi } from 'vitest'
import { Panel } from './screen'
import type { Container, Glasses } from './sdk'
import type { View } from './shell'

class Lens {
  readonly sent: { name: string; words: string }[] = []
  holding: (() => void) | null = null

  readonly glasses: Glasses = {
    start: () => Promise.resolve('made'),
    rebuild: () => Promise.resolve(true),
    words: (container: Container, words: string) => {
      this.sent.push({ name: container.name, words })
      if (container.name !== 'nibBody' || this.holding) return Promise.resolve(true)

      return new Promise<boolean>((resolve) => {
        this.holding = () => {
          resolve(true)
        }
      })
    },
    listen: () => () => undefined,
    microphone: () => Promise.resolve(true),
    leave: () => Promise.resolve(),
  }
}

const VIEW: View = { head: 'Note', rule: '─', body: 'the words', nums: '', mic: '' }

function bodies(lens: Lens): number {
  return lens.sent.filter((one) => one.name === 'nibBody').length
}

describe('what the panel believes the glasses show', () => {
  test('sends a band again that was confirmed only after the page was rebuilt', async () => {
    const lens = new Lens()
    const panel = new Panel(lens.glasses, false)

    const showing = panel.show(VIEW)
    await vi.waitFor(() => {
      expect(lens.holding).not.toBeNull()
    })

    await panel.renumber(true)
    lens.holding?.()
    await showing

    await panel.show(VIEW)
    expect(bodies(lens)).toBe(2)
  })

  test('sends a band again that was confirmed only after the app came back to the front', async () => {
    const lens = new Lens()
    const panel = new Panel(lens.glasses, false)

    const showing = panel.show(VIEW)
    await vi.waitFor(() => {
      expect(lens.holding).not.toBeNull()
    })
    panel.forget()
    lens.holding?.()
    await showing

    await panel.show(VIEW)
    expect(bodies(lens)).toBe(2)
  })

  test('does not send a band again that the glasses already show', async () => {
    const lens = new Lens()
    lens.holding = () => undefined
    const panel = new Panel(lens.glasses, false)

    await panel.show(VIEW)
    await panel.show(VIEW)

    expect(bodies(lens)).toBe(1)
  })
})

describe('turning line numbers on when the glasses cannot', () => {
  const refusing = (lens: Lens, how: () => Promise<boolean>): Panel =>
    new Panel({ ...lens.glasses, rebuild: how }, false)

  test.each([
    ['refuse', () => Promise.reject(new Error('refused'))],
    ['say no', () => Promise.resolve(false)],
  ])('when they %s, settles and keeps the page they show', async (_how, how) => {
    const lens = new Lens()
    lens.holding = () => undefined
    const panel = refusing(lens, how)

    await expect(panel.renumber(true)).resolves.toBe(false)
    await panel.show({ ...VIEW, nums: '1' })
    expect(lens.sent.map((one) => one.name)).not.toContain('nibNums')
  })
})
