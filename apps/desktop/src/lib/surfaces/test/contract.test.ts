import { afterEach, describe, expect, test } from 'vitest'
import { registerSurfaces } from '@orden/contracts'

const { canvasSurface, sheets, tasksPanel, tabOverviewLayer } = await import('../src/api')

const gone: (() => void)[] = []

afterEach(() => {
  for (const one of gone.splice(0)) one()
})

describe('a surface a module registers', () => {
  test('is drawn from what the module handed in', async () => {
    const Panel = () => undefined
    gone.push(registerSurfaces({ tasks: () => Promise.resolve({ default: Panel }) }))

    expect(await tasksPanel()).toBe(Panel)
  })

  test('and one no module registered is refused, not waited on', async () => {
    await expect(canvasSurface()).rejects.toThrow("'canvas'")
  })
})

describe('a sheet asked for through contracts', () => {
  test('opens the latched door the app draws', async () => {
    const Overview = () => undefined
    gone.push(registerSurfaces({ overview: () => Promise.resolve({ default: Overview }) }))

    expect(tabOverviewLayer.asked).toBeNull()
    await sheets.ask('overview')
    expect(await tabOverviewLayer.asked).toBe(Overview)
  })
})
