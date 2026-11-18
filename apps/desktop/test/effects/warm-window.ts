import { vi } from 'vitest'

export async function warmWindow(draw: () => () => void, ready: () => boolean): Promise<void> {
  const takeDown = draw()
  await vi
    .waitFor(
      () => {
        if (!ready()) throw new Error('the window is not drawn yet')
      },
      { timeout: 300_000, interval: 50 },
    )
    .catch(() => undefined)
  takeDown()
}
